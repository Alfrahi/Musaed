//! Indexing pipeline for RAG — discover, diff, chunk, embed, store.
//!
//! Orchestrates the full indexing flow for a project, emitting progress events
//! and supporting cancellation. Each phase is extracted into its own function
//! sharing a [`PhaseContext`] to reduce the main entry point to a pipeline
//! coordinator.

use crate::rag::chunker::chunk_content;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::error::{RagError, RagResult};
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
pub struct PhaseContext<'a, R: tauri::Runtime = tauri::Wry> {
    pub store: Arc<RwLock<RagStore>>,
    pub cancel_token: Arc<CancellationToken>,
    pub app_handle: tauri::AppHandle<R>,
    pub project_id: &'a str,
    pub project_path: &'a Path,
    pub embedding_model: &'a str,
    pub base_url: &'a str,
    pub ignore_patterns: &'a [String],
    pub force: bool,
}

impl<R: tauri::Runtime> PhaseContext<'_, R> {
    fn check_cancelled(&self) -> RagResult<()> {
        if self.cancel_token.is_cancelled() {
            Err(RagError::Cancelled("by user request".to_string()))
        } else {
            Ok(())
        }
    }

    fn emit(&self, phase: IndexPhase, current: usize, total: usize, message: String) {
        emit_progress(
            &self.app_handle,
            self.project_id,
            phase,
            current,
            total,
            message,
        );
    }
}

// ====================== PHASE OUTPUTS ======================

/// Output of the diff phase — files to index, files to delete, and cached
/// file contents (avoid re-reading from disk during chunking). Also carries
/// per-file diff counts so the completion event can report them honestly.
struct DiffOutput {
    files_to_index: Vec<(String, u64, String)>,
    files_to_delete: Vec<i64>,
    file_contents: HashMap<String, Vec<u8>>,
    files_added: u64,
    files_modified: u64,
    files_unchanged: u64,
    skipped_read_failed: u64,
}

/// Output of the chunk phase — raw chunks grouped by file.
struct ChunkOutput {
    all_raw_chunks: Vec<(String, u64, String, Vec<RawChunk>)>,
    total_chunks: usize,
    skipped_non_utf8: u64,
}

/// Working accumulators inside the diff blocking task.
#[derive(Default)]
struct DiffStats {
    files_to_index: Vec<(String, u64, String)>,
    files_to_delete: Vec<i64>,
    file_contents: HashMap<String, Vec<u8>>,
    files_added: u64,
    files_modified: u64,
    files_unchanged: u64,
    skipped_read_failed: u64,
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
///
/// On failure (including cancellation), the project status is set to `Error` so the
/// UI can offer a retry. Without this, a cancelled or failed index would leave the
/// project stuck in `Indexing` status permanently.
pub async fn index_project<R: tauri::Runtime>(
    store: Arc<RwLock<RagStore>>,
    opts: IndexOptions<'_>,
    cancel_token: Arc<CancellationToken>,
    app_handle: tauri::AppHandle<R>,
) -> RagResult<()> {
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
        s.set_status(ctx.project_id, &ProjectStatus::Indexing)
            .await?;
    }

    // Clone the fields needed for error recovery before moving ctx into the pipeline.
    let store_clone = Arc::clone(&ctx.store);
    let project_id_clone = ctx.project_id.to_string();

    // Run the pipeline; on any error (including cancellation), mark the project
    // as Error so the UI can surface a retry affordance instead of leaving the
    // project stuck in Indexing forever.
    let result = run_pipeline(ctx).await;
    if let Err(ref e) = result {
        tracing::warn!(
            project_id = %project_id_clone,
            error = %e,
            "Indexing pipeline failed — marking project as Error"
        );
        if let Ok(s) = store_clone.try_write() {
            let _ = s.set_status(&project_id_clone, &ProjectStatus::Error).await;
        }
    }

    result
}

async fn run_pipeline<R: tauri::Runtime>(ctx: PhaseContext<'_, R>) -> RagResult<()> {
    // ── fs walk: sync I/O — off the async runtime ──
    let discovered = {
        let path = ctx.project_path.to_path_buf();
        let patterns = ctx.ignore_patterns.to_vec();
        let ah = ctx.app_handle.clone();
        let pid = ctx.project_id.to_string();
        tokio::task::spawn_blocking(move || {
            discover_sync(&path, &patterns, |phase, cur, total, msg| {
                emit_progress(&ah, &pid, phase, cur, total, msg);
            })
        })
        .await
        .map_err(|e| RagError::Config(format!("discover task join error: {}", e)))??
    };

    let diff = phase_diff(&ctx, &discovered).await?;
    phase_delete_stale(&ctx, &diff.files_to_delete).await?;
    let chunked = phase_chunk(&ctx, &diff).await?;
    let embedded = phase_embed(&ctx, &chunked).await?;
    let summary = crate::rag::types::IndexSummary {
        files_added: diff.files_added,
        files_modified: diff.files_modified,
        files_deleted: diff.files_to_delete.len() as u64,
        files_unchanged: diff.files_unchanged,
        skipped_read_failed: diff.skipped_read_failed,
        skipped_non_utf8: chunked.skipped_non_utf8,
    };
    phase_store(&ctx, &discovered, &chunked, &embedded).await?;
    phase_complete(&ctx, &discovered, chunked.total_chunks, summary).await?;

    Ok(())
}

// ====================== PHASE 1: DISCOVER ======================

/// Sync fs-walk helper; emits progress through `emit`. Called on the
/// blocking thread pool — never directly from an async context.
fn discover_sync<E: Fn(IndexPhase, usize, usize, String)>(
    project_path: &Path,
    ignore_patterns: &[String],
    emit: E,
) -> RagResult<Vec<crate::rag::ignore::DiscoveredFile>> {
    emit(
        IndexPhase::DiscoveringFiles,
        0,
        1,
        "Discovering files...".to_string(),
    );

    let discovered = discover_files(project_path, ignore_patterns)?;
    let total_files = discovered.len();

    emit(
        IndexPhase::DiscoveringFiles,
        1,
        1,
        format!("Found {} files", total_files),
    );

    Ok(discovered)
}

// ====================== PHASE 2: DIFF ======================

/// Diff discovered files against tracked files. The per-file fs::read + xxh3
/// loop is pure sync I/O, so it runs on the blocking thread pool.
async fn phase_diff<R: tauri::Runtime>(
    ctx: &PhaseContext<'_, R>,
    discovered: &[crate::rag::ignore::DiscoveredFile],
) -> RagResult<DiffOutput> {
    let total_files = discovered.len();
    ctx.emit(
        IndexPhase::DiffingFiles,
        0,
        total_files,
        "Checking for changes...".to_string(),
    );

    let tracked_files = {
        let s = ctx.store.read().await;
        s.get_project_files(ctx.project_id).await?
    };

    let tracked_map: HashMap<String, (String, i64)> = tracked_files
        .iter()
        .filter_map(|f| {
            f.id.map(|id| (f.relative_path.clone(), (f.file_hash.clone(), id)))
        })
        .collect();

    // fs::read + xxh3 hashing is sync I/O/CPU — off the async runtime.
    let discovered_owned = discovered.to_vec();
    let cancel = ctx.cancel_token.clone();
    let force = ctx.force;
    let diff_stats = tokio::task::spawn_blocking(move || -> RagResult<DiffStats> {
        let mut out = DiffStats::default();

        for file in &discovered_owned {
            if cancel.is_cancelled() {
                return Err(RagError::Cancelled("by user request".to_string()));
            }

            let content = match std::fs::read(&file.path) {
                Ok(c) => c,
                Err(e) => {
                    tracing::debug!("Failed to read file {:?}: {}", file.path, e);
                    out.skipped_read_failed += 1;
                    continue;
                }
            };

            let hash = format!("{:016x}", xxh3_64(&content));

            let tracked = tracked_map.get(&file.relative_path);
            let needs_index = force || tracked.map(|(h, _)| h != &hash).unwrap_or(true);

            if needs_index {
                if tracked.is_some() {
                    out.files_modified += 1;
                } else {
                    out.files_added += 1;
                }
                out.file_contents
                    .insert(file.relative_path.clone(), content);
                out.files_to_index
                    .push((file.relative_path.clone(), file.size, hash));
            } else {
                out.files_unchanged += 1;
            }
        }

        let discovered_set: HashSet<String> = discovered_owned
            .iter()
            .map(|f| f.relative_path.clone())
            .collect();
        for (path, (_, file_id)) in &tracked_map {
            if !discovered_set.contains(path) {
                out.files_to_delete.push(*file_id);
            }
        }

        Ok(out)
    })
    .await
    .map_err(|e| RagError::Config(format!("diff task join error: {}", e)))??;

    ctx.emit(
        IndexPhase::DiffingFiles,
        total_files,
        total_files,
        format!(
            "{} new, {} modified, {} deleted",
            diff_stats.files_added,
            diff_stats.files_modified,
            diff_stats.files_to_delete.len()
        ),
    );

    Ok(DiffOutput {
        files_to_index: diff_stats.files_to_index,
        files_to_delete: diff_stats.files_to_delete,
        file_contents: diff_stats.file_contents,
        files_added: diff_stats.files_added,
        files_modified: diff_stats.files_modified,
        files_unchanged: diff_stats.files_unchanged,
        skipped_read_failed: diff_stats.skipped_read_failed,
    })
}

// ====================== PHASE 3: DELETE STALE ======================

/// Delete stale file records (files that exist in the index but no longer
/// on disk).  Drops the write guard between batches so other operations
/// are not starved.
async fn phase_delete_stale<R: tauri::Runtime>(
    ctx: &PhaseContext<'_, R>,
    files_to_delete: &[i64],
) -> RagResult<()> {
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
async fn phase_chunk<R: tauri::Runtime>(
    ctx: &PhaseContext<'_, R>,
    diff: &DiffOutput,
) -> RagResult<ChunkOutput> {
    let file_count = diff.files_to_index.len();
    ctx.emit(
        IndexPhase::ReadingFiles,
        0,
        file_count,
        "Reading files...".to_string(),
    );

    // tree-sitter chunking is CPU-bound sync work — off the async runtime.
    let files = diff.files_to_index.clone();
    let contents = diff.file_contents.clone();
    let cancel = ctx.cancel_token.clone();
    let ah = ctx.app_handle.clone();
    let pid = ctx.project_id.to_string();
    let all_raw_chunks = tokio::task::spawn_blocking(move || -> RagResult<_> {
        let mut out: Vec<(String, u64, String, Vec<RawChunk>)> = Vec::new();
        let mut skipped_non_utf8: u64 = 0;
        for (i, (relative_path, file_size, hash)) in files.iter().enumerate() {
            if cancel.is_cancelled() {
                return Err(RagError::Cancelled("by user request".to_string()));
            }

            let content = match contents.get(relative_path) {
                Some(bytes) => match std::str::from_utf8(bytes) {
                    Ok(s) => s.to_string(),
                    Err(_) => {
                        tracing::debug!("Skipping non-UTF-8 file: {}", relative_path);
                        skipped_non_utf8 += 1;
                        continue;
                    }
                },
                None => {
                    tracing::debug!("Content not cached for {}, skipping", relative_path);
                    continue;
                }
            };

            emit_progress(
                &ah,
                &pid,
                IndexPhase::ChunkingFiles,
                i,
                file_count,
                format!("Chunking {}...", relative_path),
            );

            let chunks = chunk_content(&content, relative_path);
            out.push((relative_path.clone(), *file_size, hash.clone(), chunks));
        }
        Ok((out, skipped_non_utf8))
    })
    .await
    .map_err(|e| RagError::Config(format!("chunk task join error: {}", e)))??;

    let (all_raw_chunks, skipped_non_utf8) = all_raw_chunks;

    let total_chunks: usize = all_raw_chunks.iter().map(|(_, _, _, c)| c.len()).sum();
    ctx.emit(
        IndexPhase::ChunkingFiles,
        file_count,
        file_count,
        format!("Total: {} chunks from {} files", total_chunks, file_count),
    );

    Ok(ChunkOutput {
        all_raw_chunks,
        total_chunks,
        skipped_non_utf8,
    })
}

// ====================== PHASE 5: EMBED ======================

/// Generate embeddings for all chunks via the Ollama embedder.
/// Detects the embedding dimension on the first run and stores it.
async fn phase_embed<R: tauri::Runtime>(
    ctx: &PhaseContext<'_, R>,
    chunked: &ChunkOutput,
) -> RagResult<EmbedOutput> {
    ctx.emit(
        IndexPhase::EmbeddingChunks,
        0,
        chunked.total_chunks,
        format!(
            "Embedding {} chunks via {}...",
            chunked.total_chunks, ctx.embedding_model
        ),
    );

    let mut embedder = OllamaEmbedder::new(ctx.base_url, ctx.embedding_model);

    if let Err(e) = embedder.detect_dimension().await {
        return Err(RagError::EmbedFailed(format!(
            "Failed to detect embedding dimension: {}. Is the model '{}' running?",
            e, ctx.embedding_model
        )));
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
                    format!(
                        "Embedding batch {}/{} ({} chunks)",
                        batch_idx, _total_batches, chunks_done
                    ),
                );
            })),
        )
        .await?;

    ctx.check_cancelled()?;

    Ok(EmbedOutput { all_embeddings })
}

// ====================== PHASE 6: STORE ======================

/// Store chunks and their embeddings in the database.
///
/// The write guard is acquired **per file** (not held across the entire
/// phase) so other operations — index abort, project updates, searches,
/// deletions — are not starved for the full duration of a large store phase.
/// Progress events are emitted every 100 chunks.
///
/// Cancellation is checked at the top of each file iteration **and** every
/// 100 chunks inside the inner loop, so a very large file (e.g. 10 000+
/// chunks) does not keep running for minutes after the user clicks cancel.
async fn phase_store<R: tauri::Runtime>(
    ctx: &PhaseContext<'_, R>,
    discovered: &[crate::rag::ignore::DiscoveredFile],
    chunked: &ChunkOutput,
    embedded: &EmbedOutput,
) -> RagResult<()> {
    ctx.emit(
        IndexPhase::StoringChunks,
        0,
        chunked.total_chunks,
        "Storing chunks and embeddings...".to_string(),
    );

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
            .unwrap_or_else(|| {
                tracing::warn!(
                    "Failed to read file mtime for {:?}; storing empty modified_at",
                    full_path
                );
                String::new()
            });

        let file_record = FileRecord {
            id: None,
            project_id: ctx.project_id.to_string(),
            relative_path: relative_path.clone(),
            file_hash: file_hash.clone(),
            file_size: *file_size,
            modified_at: mtime,
            chunk_count: chunks.len(),
        };

        // Acquire the write guard only for this file's writes, then drop
        // it before the next file so concurrent operations are not blocked.
        {
            let s = ctx.store.write().await;
            let file_id = s.upsert_file(&file_record).await?;
            let _ = s.delete_file_chunks(file_id).await;

            // Build all rows for this file, then persist chunks + embeddings
            // in one transaction — a failure mid-file rolls back everything,
            // so no partial file state can be observed (RAG P2).
            let chunk_rows: Vec<ChunkRow> = chunks
                .iter()
                .enumerate()
                .map(|(chunk_idx, chunk)| ChunkRow {
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
                })
                .collect();

            let end = (embedding_idx + chunks.len()).min(embedded.all_embeddings.len());
            let embeddings: Vec<Vec<f32>> = if embedding_idx < end {
                embedded.all_embeddings[embedding_idx..end].to_vec()
            } else {
                Vec::new()
            };
            embedding_idx += chunks.len();

            s.insert_chunks_with_embeddings(&chunk_rows, &embeddings)
                .await?;

            total_stored += chunks.len();

            if total_stored / 100 != (total_stored - chunks.len()) / 100
                || total_stored == chunked.total_chunks
            {
                ctx.emit(
                    IndexPhase::StoringChunks,
                    total_stored,
                    chunked.total_chunks,
                    format!("Stored {}/{} chunks", total_stored, chunked.total_chunks),
                );
            }
        }
    }

    // Final stats update under its own short-lived write guard.
    {
        let s = ctx.store.write().await;
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
async fn phase_complete<R: tauri::Runtime>(
    ctx: &PhaseContext<'_, R>,
    discovered: &[crate::rag::ignore::DiscoveredFile],
    total_chunks: usize,
    summary: crate::rag::types::IndexSummary,
) -> RagResult<()> {
    ctx.emit(
        IndexPhase::Completed,
        total_chunks,
        total_chunks,
        "Indexing complete!".to_string(),
    );

    let (file_count, chunk_count, total_bytes) = {
        let s = ctx.store.write().await;
        s.set_status(ctx.project_id, &ProjectStatus::Ready).await?;
        let stats = s.get_project_stats(ctx.project_id).await?;
        (stats.file_count, stats.chunk_count, stats.total_bytes)
    };

    // Dedicated completion event — the frontend listener on
    // `rag-index-complete` (useRagIndexing) refreshes the project card from
    // this payload; the progress event alone never flips the card state.
    let complete = crate::rag::types::IndexComplete {
        project_id: ctx.project_id.to_string(),
        indexed_at: chrono::Utc::now().to_rfc3339(),
        file_count,
        chunk_count,
        total_bytes,
        summary: summary.clone(),
    };
    if let Err(e) = ctx
        .app_handle
        .emit(crate::shared::EVENT_RAG_INDEX_COMPLETE, &complete)
    {
        tracing::debug!("Failed to emit index complete: {}", e);
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
fn emit_progress<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
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
