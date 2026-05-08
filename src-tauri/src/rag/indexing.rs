//! Indexing pipeline for RAG — discover, diff, chunk, embed, store.
//!
//! Orchestrates the full indexing flow for a project, emitting progress events
//! and supporting cancellation.

use tracing;
use crate::rag::chunker::chunk_content;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::ignore::discover_files;
use crate::rag::store::RagStore;
use crate::rag::types::{ChunkRow, FileRecord, IndexPhase, IndexProgress, ProjectStatus, RawChunk};
use std::path::Path;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use xxhash_rust::xxh3::xxh3_64;

// ====================== INDEXING PIPELINE ======================

/// Run the indexing pipeline for a project.
///
/// This is the main entry point called from the Tauri command.
/// It walks the project directory, diffs against tracked files, chunks new/modified
/// files, generates embeddings via Ollama, and stores everything in SQLite.
pub async fn index_project(
    store: Arc<Mutex<RagStore>>,
    project_id: &str,
    project_path: &str,
    embedding_model: &str,
    base_url: &str,
    ignore_patterns: &[String],
    force: bool,
    cancel_token: Arc<CancellationToken>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let project_path = Path::new(project_path);

    // Mark project as indexing
    {
        let s = store.lock().await;
        s.set_status(project_id, &ProjectStatus::Indexing)?;
    }

    // === Phase 1: Discover files ===
    emit_progress(&app_handle, project_id, IndexPhase::DiscoveringFiles, 0, 1,
        "Discovering files...".to_string());

    let discovered = discover_files(project_path, ignore_patterns)?;
    let total_files = discovered.len();

    emit_progress(&app_handle, project_id, IndexPhase::DiscoveringFiles, 1, 1,
        format!("Found {} files", total_files));

    if cancel_token.is_cancelled() {
        return Err("Indexing cancelled".to_string());
    }

    // === Phase 2: Diff against tracked files ===
    emit_progress(&app_handle, project_id, IndexPhase::DiffingFiles, 0, total_files,
        "Checking for changes...".to_string());

    let tracked_files = {
        let s = store.lock().await;
        s.get_project_files(project_id)?
    };

    // Build a map of tracked file paths -> (hash, file_id)
    let tracked_map: std::collections::HashMap<String, (String, i64)> = tracked_files
        .iter()
        .filter_map(|f| f.id.map(|id| (f.relative_path.clone(), (f.file_hash.clone(), id))))
        .collect();

    // Determine new, modified, and deleted files
    let mut files_to_index: Vec<(String, u64, String)> = Vec::new(); // (relative_path, size, hash)
    let mut files_to_delete: Vec<i64> = Vec::new(); // file IDs
    let mut file_contents: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new(); // cache for Phase 4

    // Find new and modified files (read content once for both hashing and later chunking)
    for file in &discovered {
        if cancel_token.is_cancelled() {
            return Err("Indexing cancelled".to_string());
        }

        let content = match std::fs::read(&file.path) {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!("Failed to read file {:?}: {}", file.path, e);
                continue;
            }
        };

        let hash = format!("{:016x}", xxh3_64(&content));

        let needs_index = if force {
            true
        } else if let Some((tracked_hash, _)) = tracked_map.get(&file.relative_path) {
            tracked_hash != &hash
        } else {
            true // New file
        };

        if needs_index {
            // Cache content for chunking phase (avoid re-reading)
            file_contents.insert(file.relative_path.clone(), content);
            files_to_index.push((file.relative_path.clone(), file.size, hash));
        }
    }

    // Find deleted files (tracked but no longer on disk)
    let discovered_set: std::collections::HashSet<String> = discovered
        .iter()
        .map(|f| f.relative_path.clone())
        .collect();

    for (path, (_, file_id)) in &tracked_map {
        if !discovered_set.contains(path) {
            files_to_delete.push(*file_id);
        }
    }

    emit_progress(&app_handle, project_id, IndexPhase::DiffingFiles, total_files, total_files,
        format!("{} new/modified, {} deleted", files_to_index.len(), files_to_delete.len()));

    // === Phase 3: Delete stale files ===
    emit_progress(&app_handle, project_id, IndexPhase::DeletingStale, 0, files_to_delete.len(),
        format!("Removing {} stale files...", files_to_delete.len()));

    {
        let s = store.lock().await;
        for (i, file_id) in files_to_delete.iter().enumerate() {
            if cancel_token.is_cancelled() {
                return Err("Indexing cancelled".to_string());
            }
            s.delete_file(*file_id)?;
            if i % 100 == 0 {
                emit_progress(&app_handle, project_id, IndexPhase::DeletingStale, i, files_to_delete.len(),
                    format!("Deleted {}/{} stale files", i, files_to_delete.len()));
            }
        }
    }

    // === Phase 4: Read and chunk files ===
    emit_progress(&app_handle, project_id, IndexPhase::ReadingFiles, 0, files_to_index.len(),
        "Reading files...".to_string());

    let mut all_raw_chunks: Vec<(String, u64, String, Vec<RawChunk>)> = Vec::new(); // (relative_path, size, hash, chunks)

    for (i, (relative_path, file_size, hash)) in files_to_index.iter().enumerate() {
        if cancel_token.is_cancelled() {
            return Err("Indexing cancelled".to_string());
        }

        // Use cached content from Phase 2 (avoid re-reading the file)
        let content = match file_contents.get(relative_path) {
            Some(bytes) => match std::str::from_utf8(bytes) {
                Ok(s) => s.to_string(),
                Err(_) => {
                    tracing::debug!("Skipping non-UTF-8 file: {}", relative_path);
                    continue;
                }
            },
            None => {
                tracing::debug!("Content not cached for {}, skipping", relative_path);
                continue;
            }
        };

        emit_progress(&app_handle, project_id, IndexPhase::ChunkingFiles, i, files_to_index.len(),
            format!("Chunking {}...", relative_path));

        let chunks = chunk_content(&content, relative_path);
        all_raw_chunks.push((relative_path.clone(), *file_size, hash.clone(), chunks));
    }

    let total_chunks: usize = all_raw_chunks.iter().map(|(_, _, _, c)| c.len()).sum();
    emit_progress(&app_handle, project_id, IndexPhase::ChunkingFiles, files_to_index.len(), files_to_index.len(),
        format!("Total: {} chunks from {} files", total_chunks, files_to_index.len()));

    // === Phase 5: Embed chunks ===
    emit_progress(&app_handle, project_id, IndexPhase::EmbeddingChunks, 0, total_chunks,
        format!("Embedding {} chunks via {}...", total_chunks, embedding_model));

    let mut embedder = OllamaEmbedder::new(base_url, embedding_model);

    // Detect dimension on first run
    if let Err(e) = embedder.detect_dimension().await {
        return Err(format!("Failed to detect embedding dimension: {}. Is the model '{}' running?", e, embedding_model));
    }

    let dimension = embedder.dimension().unwrap_or(768);

    // Store detected dimension
    {
        let s = store.lock().await;
        s.set_embedding_dimension(project_id, dimension)?;
    }

    // Collect all chunk texts for batch embedding
    let all_chunk_texts: Vec<String> = all_raw_chunks
        .iter()
        .flat_map(|(_, _, _, chunks)| chunks.iter().map(|c| c.content.clone()))
        .collect();

    // Embed in batches with progress
    let app_handle_clone = app_handle.clone();
    let project_id_clone = project_id.to_string();
    let all_embeddings = embedder
        .embed_chunks(all_chunk_texts, Some(Box::new(move |batch_idx, total_batches, chunks_done| {
            emit_progress(
                &app_handle_clone,
                &project_id_clone,
                IndexPhase::EmbeddingChunks,
                chunks_done,
                total_chunks,
                format!("Embedding batch {}/{} ({} chunks)", batch_idx, total_batches, chunks_done),
            );
        })))
        .await?;

    if cancel_token.is_cancelled() {
        return Err("Indexing cancelled".to_string());
    }

    // === Phase 6: Store chunks and embeddings ===
    emit_progress(&app_handle, project_id, IndexPhase::StoringChunks, 0, total_chunks,
        "Storing chunks and embeddings...".to_string());

    {
        let s = store.lock().await;
        let mut embedding_idx = 0;
        let mut total_stored = 0usize;
        let mut total_bytes: u64 = 0;

        for (relative_path, file_size, file_hash, chunks) in &all_raw_chunks {
            if cancel_token.is_cancelled() {
                return Err("Indexing cancelled".to_string());
            }

            total_bytes += file_size;

            // Get mtime
            let full_path = project_path.join(relative_path);
            let mtime = std::fs::metadata(&full_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let datetime: chrono::DateTime<chrono::Utc> = t.into();
                    datetime.to_rfc3339()
                })
                .unwrap_or_default();

            // Upsert file record
            let file_record = FileRecord {
                id: None,
                project_id: project_id.to_string(),
                relative_path: relative_path.clone(),
                file_hash: file_hash.clone(),
                file_size: *file_size,
                modified_at: mtime,
                chunk_count: chunks.len(),
            };

            let file_id = s.upsert_file(&file_record)?;

            // Delete old chunks for this file (if re-indexing)
            let _ = s.delete_file_chunks(file_id);

            // Insert chunks and embeddings
            for (chunk_idx, chunk) in chunks.iter().enumerate() {
                let chunk_row = ChunkRow {
                    id: None,
                    project_id: project_id.to_string(),
                    file_id,
                    chunk_index: chunk_idx,
                    content: chunk.content.clone(),
                    chunk_type: chunk.chunk_type.as_str().to_string(),
                    language: chunk.language.clone(),
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    metadata: chunk.metadata.clone(),
                };

                let chunk_id = s.insert_chunk(&chunk_row)?;

                // Insert corresponding embedding
                if embedding_idx < all_embeddings.len() {
                    s.insert_embedding(chunk_id, &all_embeddings[embedding_idx])?;
                }

                embedding_idx += 1;
                total_stored += 1;

                if total_stored % 100 == 0 {
                    emit_progress(&app_handle, project_id, IndexPhase::StoringChunks, total_stored, total_chunks,
                        format!("Stored {}/{} chunks", total_stored, total_chunks));
                }
            }
        }

        // Update project stats
        let file_count = discovered.len() as u64;
        // Get total chunk count from store
        let stats = s.get_project_stats(project_id)?;
        s.update_project_stats(
            project_id,
            file_count,
            stats.chunk_count,
            total_bytes,
            Some(&chrono::Utc::now().to_rfc3339()),
        )?;
    }

    // === Phase 7: Complete ===
    emit_progress(&app_handle, project_id, IndexPhase::Completed, total_chunks, total_chunks,
        "Indexing complete!".to_string());

    // Mark project as ready
    {
        let s = store.lock().await;
        s.set_status(project_id, &ProjectStatus::Ready)?;
    }

    tracing::info!("Indexing complete for project {}: {} files, {} chunks", project_id, discovered.len(), total_chunks);

    Ok(())
}

/// Emit an indexing progress event to the frontend.
fn emit_progress(
    app_handle: &tauri::AppHandle,
    project_id: &str,
    phase: IndexPhase,
    current: usize,
    total: usize,
    message: String,
) {
    let progress = IndexProgress {
        project_id: project_id.to_string(),
        phase,
        current,
        total,
        message,
    };

    if let Err(e) = app_handle.emit(crate::shared::EVENT_RAG_INDEX_PROGRESS, &progress) {
        tracing::debug!("Failed to emit index progress: {}", e);
    }
}
