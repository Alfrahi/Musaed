//! Project statistics computation.

use super::connection::MAX_EMBEDDING_DIMENSION;
use crate::rag::types::ProjectStats;
use rusqlite::OptionalExtension;

/// Compute statistics for a project.
pub(super) async fn get_project_stats(
    store: &super::RagStore,
    project_id: &str,
) -> Result<ProjectStats, String> {
    let conn = store.read_conn().await;

    let file_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE project_id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count files: {}", e))?;

    let chunk_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chunks WHERE project_id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count chunks: {}", e))?;

    let total_bytes: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(file_size), 0) FROM files WHERE project_id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to sum bytes: {}", e))?;

    let embedding_dimension: i64 = conn
        .query_row(
            "SELECT embedding_dimension FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to get embedding dimension: {}", e))?;

    let last_indexed: Option<String> = conn
        .query_row(
            "SELECT indexed_at FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to get last indexed: {}", e))?
        .flatten();

    // Estimate index size (rough: vectors + metadata)
    let index_size_bytes = (chunk_count as u64) * (MAX_EMBEDDING_DIMENSION as u64 * 4 + 500);

    Ok(ProjectStats {
        file_count: file_count as u64,
        chunk_count: chunk_count as u64,
        total_bytes: total_bytes as u64,
        embedding_dimension: embedding_dimension as usize,
        index_size_bytes,
        last_indexed,
    })
}
