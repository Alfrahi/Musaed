//! Indexing pipeline for RAG — discover, diff, chunk, embed, store.
//!
//! Orchestrates the full indexing flow for a project, emitting progress events
//! and supporting cancellation. Each phase is extracted into its own function
//! sharing a [`PhaseContext`] to reduce the main entry point to a pipeline
//! coordinator.

use crate::rag::chunker::chunk_content;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::ignore::discover_files;
use crate::rag::store::RagStore;
use crate::rag::types::{ChunkRow, FileRecord, IndexPhase, IndexProgress, ProjectStatus, RawChunk};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing;
use xxhash_rust::xxh3::xxh3_64;

// ====================== SHARED CONTEXT ======================

/// Context shared across all indexing phases.
///
/// Holds the store reference, cancellation token, app handle for event
/// emission, and the original [`IndexOptions`].  The write guard on the
/// store is dropped between phases so long-running operations (embedding,
/// chunking) do not hold it.
pub struct PhaseContext<'a> {
    pub store: Arc<RwLock<RagStore>>,
    pub cancel_token: Arc<CancellationToken>,
    pub app_handle: tauri::AppHandle,
    pub project_id: &'a str,
    pub project_path: &'a Path,
    pub embedding_model: &'a str,
    pub base_url: &'a str,
    pub ignore_patterns: &'a [String],
    pub force: bool,
}

impl PhaseContext<'_> {
    fn check_cancelled(&self) -> Result<(), String> {
        if self.cancel_token.is_cancelled() {
            Err("Indexing cancelled".to_string())
        } else {
            Ok(())
        }
    }

    fn emit(&self, phase: IndexPhase, current: usize, total: usize, message: String) {
        emit_progress(&self.app_handle, self.project_id, phase, current, total, message);
    }
}

// ====================== PHASE OUTPUTS ======================

/// Output of the diff phase — files to index, files to delete, and cached
/// file contents (avoid re-reading from disk during chunking).
struct DiffOutput {
    files_to_index: Vec<(String, u64, String)>,
    files_to_delete: Vec<i64>,
    file_contents: HashMap<String, Vec<u8>>,
}

/// Output of the chunk phase — raw chunks grouped by file.
struct ChunkOutput {
    all_raw_chunks: Vec<(String, u64, String, Vec<RawChunk>)>,
    total_chunks: usize,
}

/// Output of the embed phase — dense vectors for every chunk.
struct EmbedOutput {
    all_embeddings: Vec<Vec<f32>>,
}

// ====================== CONFIGURATION ======================

/// Configuration for an indexing run.
pub struct IndexOptions<'a> {
    pub project_id: &'a str,
    pub project_path: &'a str,
    pub embedding_model: &'a str,
    pub base_url: &'a str,
    pub ignore_patterns: &'a [String],
    pub force: bool,
}

// ====================== PIPELINE COORDINATOR ======================

/// Run the indexing pipeline for a project.
///
/// This is the main entry point called from the Tauri command.
/// It walks the project directory, diffs against tracked files, chunks new/modified
/// files, generates embeddings via Ollama, and stores everything in SQLite.
pub async fn index_project(
    store: Arc<RwLock<RagStore>>,
    opts: IndexOptions<'_>,
    cancel_token: Arc<CancellationToken>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let ctx = PhaseContext {
        store,
        cancel_token,
        app_handle,
        project_id: opts.project_id,
        project_path: Path::new(opts.project_path),
        embedding_model: opts.embedding_model,
        base_url: opts.base_url,
        ignore_patterns: opts.ignore_patterns,
        force: opts.force,
    };

    // Mark project as indexing
    {
        let s = ctx.store.write().await;
        s.set_status(ctx.project_id, &ProjectStatus::Indexing).await?;
    }

    let discovered = phase_discover(&ctx)?;
    let diff = phase_diff(&ctx, &discovered).await?;
    phase_delete_stale(&ctx, &diff.files_to_delete).await?;
    let chunked = phase_chunk(&ctx, &diff).await?;
    let embedded = phase_embed(&ctx, &chunked).await?;
    phase_store(&ctx, &discovered, &chunked, &embedded).await?;
    phase_complete(&ctx, &discovered, chunked.total_chunks).await?;

    Ok(())
}

// ====================== PHASE 1: DISCOVER ======================

/// Discover files in the project directory, respecting ignore patterns.
fn phase_discover(ctx: &PhaseContext) -> Result<Vec<crate::rag::ignore::DiscoveredFile>, String> {
    ctx.emit(IndexPhase::DiscoveringFiles, 0, 1, "Discovering files...".to_string());

    let discovered = discover_files(ctx.project_path, ctx.ignore_patterns)?;
    let total_files = discovered.len();

    ctx.emit(
        IndexPhase::DiscoveringFiles,
        1,
        1,
        format!("Found {} files", total_files),
    );

    Ok(discovered)
}

// ====================== PHASE 2: DIFF ======================

/// Diff discovered files against tracked files to find new, modified, and
/// deleted files.  Reads file content once and caches it for the chunking
/// phase to avoid re-reading from disk.
async fn phase_diff(
    ctx: &PhaseContext<'_>,
    discovered: &[crate::rag::ignore::DiscoveredFile],
) -> Result<DiffOutput, String> {
    let total_files = discovered.len();
    ctx.emit(IndexPhase::DiffingFiles, 0, total_files, "Checking for changes...".to_string());

    let tracked_files = {
        let s = ctx.store.read().await;
        s.get_project_files(ctx.project_id).await?
    };

    let tracked_map: HashMap<String, (String, i64)> = tracked_files
        .iter()
        .filter_map(|f| f.id.map(|id| (f.relative_path.clone(), (f.file_hash.clone(), id))))
        .collect();

    let mut files_to_index: Vec<(String, u64, String)> = Vec::new();
    let mut files_to_delete: Vec<i64> = Vec::new();
    let mut file_contents: HashMap<String, Vec<u8>> = HashMap::new();

    for file in discovered {
        ctx.check_cancelled()?;

        let content = match std::fs::read(&file.path) {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!("Failed to read file {:?}: {}", file.path, e);
                continue;
            }
        };

        let hash = format!("{:016x}", xxh3_64(&content));

        let needs_index = if ctx.force {
            true
        } else if let Some((tracked_hash, _)) = tracked_map.get(&file.relative_path) {
            tracked_hash != &hash
        } else {
            true
        };

        if needs_index {
            file_contents.insert(file.relative_path.clone(), content);
            files_to_index.push((file.relative_path.clone(), file.size, hash));
        }
    }

    let discovered_set: HashSet<String> = discovered.iter().map(|f| f.relative_path.clone()).collect();
    for (path, (_, file_id)) in &tracked_map {
        if !discovered_set.contains(path) {
            files_to_delete.push(*file_id);
        }
    }

    ctx.emit(
        IndexPhase::DiffingFiles,
        total_files,
        total_files,
        format!("{} new/modified, {} deleted", files_to_index.len(), files_to_delete.len()),
    );

    Ok(DiffOutput { files_to_index, files_to_delete, file_contents })
}

// ====================== PHASE 3: DELETE STALE ======================

/// Delete stale file records (files that exist in the index but no longer
/// on disk).  Drops the write guard between batches so other operations
/// are not starved.
async fn phase_delete_stale(ctx: &PhaseContext<'_>, files_to_delete: &[i64]) -> Result<(), String> {
    ctx.emit(
        IndexPhase::DeletingStale,
        0,
        files_to_delete.len(),
        format!("Removing {} stale files...", files_to_delete.len()),
    );

    {
        let s = ctx.store.write().await;
        for (i, file_id) in files_to_delete.iter().enumerate() {
            ctx.check_cancelled()?;
            s.delete_file(*file_id).await?;
            if i % 100 == 0 {
                ctx.emit(
                    IndexPhase::DeletingStale,
                    i,
                    files_to_delete.len(),
                    format!("Deleted {}/{} stale files", i, files_to_delete.len()),
                );
            }
        }
    }

    Ok(())
}

// ====================== PHASE 4: CHUNK ======================

/// Read cached file content and split into chunks.  Uses the content
/// cached during the diff phase to avoid re-reading files from disk.
async fn phase_chunk(ctx: &PhaseContext<'_>, diff: &DiffOutput) -> Result<ChunkOutput, String> {
    let file_count = diff.files_to_index.len();
    ctx.emit(IndexPhase::ReadingFiles, 0, file_count, "Reading files...".to_string());

    let mut all_raw_chunks: Vec<(String, u64, String, Vec<RawChunk>)> = Vec::new();

    for (i, (relative_path, file_size, hash)) in diff.files_to_index.iter().enumerate() {
        ctx.check_cancelled()?;

        let content = match diff.file_contents.get(relative_path) {
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

        ctx.emit(
            IndexPhase::ChunkingFiles,
            i,
            file_count,
            format!("Chunking {}...", relative_path),
        );

        let chunks = chunk_content(&content, relative_path);
        all_raw_chunks.push((relative_path.clone(), *file_size, hash.clone(), chunks));
    }

    let total_chunks: usize = all_raw_chunks.iter().map(|(_, _, _, c)| c.len()).sum();
    ctx.emit(
        IndexPhase::ChunkingFiles,
        file_count,
        file_count,
        format!("Total: {} chunks from {} files", total_chunks, file_count),
    );

    Ok(ChunkOutput { all_raw_chunks, total_chunks })
}

// ====================== PHASE 5: EMBED ======================

/// Generate embeddings for all chunks via the Ollama embedder.
/// Detects the embedding dimension on the first run and stores it.
async fn phase_embed(
    ctx: &PhaseContext<'_>,
    chunked: &ChunkOutput,
) -> Result<EmbedOutput, String> {
    ctx.emit(
        IndexPhase::EmbeddingChunks,
        0,
        chunked.total_chunks,
        format!("Embedding {} chunks via {}...", chunked.total_chunks, ctx.embedding_model),
    );

    let mut embedder = OllamaEmbedder::new(ctx.base_url, ctx.embedding_model);

    if let Err(e) = embedder.detect_dimension().await {
        return Err(format!(
            "Failed to detect embedding dimension: {}. Is the model '{}' running?",
            e, ctx.embedding_model
        ));
    }

    let dimension = embedder.dimension().unwrap_or(768);
    {
        let s = ctx.store.write().await;
        s.set_embedding_dimension(ctx.project_id, dimension).await?;
    }

    let all_chunk_texts: Vec<String> = chunked
        .all_raw_chunks
        .iter()
        .flat_map(|(_, _, _, chunks)| chunks.iter().map(|c| c.content.clone()))
        .collect();

    let app_handle = ctx.app_handle.clone();
    let project_id = ctx.project_id.to_string();
    let total_chunks = chunked.total_chunks;

    let all_embeddings = embedder
        .embed_chunks(
            all_chunk_texts,
            Some(Box::new(move |batch_idx, _total_batches, chunks_done| {
                emit_progress(
                    &app_handle,
                    &project_id,
                    IndexPhase::EmbeddingChunks,
                    chunks_done,
                    total_chunks,
                    format!("Embedding batch {}/{} ({} chunks)", batch_idx, _total_batches, chunks_done),
                );
            })),
        )
        .await?;

    ctx.check_cancelled()?;

    Ok(EmbedOutput { all_embeddings })
}

// ====================== PHASE 6: STORE ======================

/// Store chunks and their embeddings in the database.  Holds the write
/// guard only while actively writing; progress events are emitted every
/// 100 records.
async fn phase_store(
    ctx: &PhaseContext<'_>,
    discovered: &[crate::rag::ignore::DiscoveredFile],
    chunked: &ChunkOutput,
    embedded: &EmbedOutput,
) -> Result<(), String> {
    ctx.emit(
        IndexPhase::StoringChunks,
        0,
        chunked.total_chunks,
        "Storing chunks and embeddings...".to_string(),
    );

    {
        let s = ctx.store.write().await;
        let mut embedding_idx = 0;
        let mut total_stored = 0usize;
        let mut total_bytes: u64 = 0;

        for (relative_path, file_size, file_hash, chunks) in &chunked.all_raw_chunks {
            ctx.check_cancelled()?;
            total_bytes += file_size;

            let full_path = ctx.project_path.join(relative_path);
            let mtime = std::fs::metadata(&full_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let datetime: chrono::DateTime<chrono::Utc> = t.into();
                    datetime.to_rfc3339()
                })
                .unwrap_or_default();

            let file_record = FileRecord {
                id: None,
                project_id: ctx.project_id.to_string(),
                relative_path: relative_path.clone(),
                file_hash: file_hash.clone(),
                file_size: *file_size,
                modified_at: mtime,
                chunk_count: chunks.len(),
            };

            let file_id = s.upsert_file(&file_record).await?;
            let _ = s.delete_file_chunks(file_id).await;

            for (chunk_idx, chunk) in chunks.iter().enumerate() {
                let chunk_row = ChunkRow {
                    id: None,
                    project_id: ctx.project_id.to_string(),
                    file_id,
                    chunk_index: chunk_idx,
                    content: chunk.content.clone(),
                    chunk_type: chunk.chunk_type.as_str().to_string(),
                    language: chunk.language.clone(),
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    metadata: chunk.metadata.clone(),
                };

                let chunk_id = s.insert_chunk(&chunk_row).await?;

                if embedding_idx < embedded.all_embeddings.len() {
                    s.insert_embedding(chunk_id, &embedded.all_embeddings[embedding_idx])
                        .await?;
                }

                embedding_idx += 1;
                total_stored += 1;

                if total_stored.is_multiple_of(100) {
                    ctx.emit(
                        IndexPhase::StoringChunks,
                        total_stored,
                        chunked.total_chunks,
                        format!("Stored {}/{} chunks", total_stored, chunked.total_chunks),
                    );
                }
            }
        }

        let file_count = discovered.len() as u64;
        let stats = s.get_project_stats(ctx.project_id).await?;
        s.update_project_stats(
            ctx.project_id,
            file_count,
            stats.chunk_count,
            total_bytes,
            Some(&chrono::Utc::now().to_rfc3339()),
        )
        .await?;
    }

    Ok(())
}

// ====================== PHASE 7: COMPLETE ======================

/// Mark the project as ready and emit the completion event.
async fn phase_complete(
    ctx: &PhaseContext<'_>,
    discovered: &[crate::rag::ignore::DiscoveredFile],
    total_chunks: usize,
) -> Result<(), String> {
    ctx.emit(
        IndexPhase::Completed,
        total_chunks,
        total_chunks,
        "Indexing complete!".to_string(),
    );

    {
        let s = ctx.store.write().await;
        s.set_status(ctx.project_id, &ProjectStatus::Ready).await?;
    }

    tracing::info!(
        "Indexing complete for project {}: {} files, {} chunks",
        ctx.project_id,
        discovered.len(),
        total_chunks,
    );

    Ok(())
}

// ====================== PROGRESS EMISSION ======================

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
