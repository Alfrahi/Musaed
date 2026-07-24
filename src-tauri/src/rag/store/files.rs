//! File record CRUD operations.

use rusqlite::OptionalExtension;

/// Upsert a file record. Returns the file ID.
pub(super) async fn upsert_file(
    store: &super::RagStore,
    file: &crate::rag::types::FileRecord,
) -> Result<i64, String> {
    let conn = store.write_conn().await;

    // Check if file already exists for this project
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM files WHERE project_id = ?1 AND relative_path = ?2",
            rusqlite::params![file.project_id, file.relative_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query file: {}", e))?;

    if let Some(id) = existing_id {
        // Update existing file
        conn.execute(
            "UPDATE files SET file_hash = ?1, file_size = ?2, modified_at = ?3, chunk_count = ?4 WHERE id = ?5",
            rusqlite::params![file.file_hash, file.file_size as i64, file.modified_at, file.chunk_count as i64, id],
        )
        .map_err(|e| format!("Failed to update file: {}", e))?;
        Ok(id)
    } else {
        // Insert new file
        conn.execute(
            "INSERT INTO files (project_id, relative_path, file_hash, file_size, modified_at, chunk_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![file.project_id, file.relative_path, file.file_hash, file.file_size as i64, file.modified_at, file.chunk_count as i64],
        )
        .map_err(|e| format!("Failed to insert file: {}", e))?;
        Ok(conn.last_insert_rowid())
    }
}

/// Delete a file and all its associated chunks and embeddings.
///
/// All three deletions (embeddings, chunks, file) must happen under a **single**
/// lock acquisition to prevent race conditions.
pub(super) async fn delete_file(store: &super::RagStore, file_id: i64) -> Result<(), String> {
    let conn = store.write_conn().await;

    // Delete embeddings first (via subquery)
    conn.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
        rusqlite::params![file_id],
    )
    .map_err(|e| format!("Failed to delete embeddings: {}", e))?;

    // Delete chunks explicitly for safety, though CASCADE should handle
    conn.execute(
        "DELETE FROM chunks WHERE file_id = ?1",
        rusqlite::params![file_id],
    )
    .map_err(|e| format!("Failed to delete chunks: {}", e))?;

    // Delete file
    conn.execute(
        "DELETE FROM files WHERE id = ?1",
        rusqlite::params![file_id],
    )
    .map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}

/// Get a file by project ID and relative path.
pub(super) async fn get_file_by_path(
    store: &super::RagStore,
    project_id: &str,
    relative_path: &str,
) -> Result<Option<crate::rag::types::FileRecord>, String> {
    let conn = store.read_conn().await;

    let mut stmt = conn
        .prepare("SELECT id, project_id, relative_path, file_hash, file_size, modified_at, chunk_count FROM files WHERE project_id = ?1 AND relative_path = ?2")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let result = stmt
        .query_row(rusqlite::params![project_id, relative_path], |row| {
            Ok(crate::rag::types::FileRecord {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                relative_path: row.get(2)?,
                file_hash: row.get(3)?,
                file_size: row.get::<_, i64>(4)? as u64,
                modified_at: row.get(5)?,
                chunk_count: row.get::<_, i64>(6)? as usize,
            })
        })
        .optional()
        .map_err(|e| format!("Failed to query file: {}", e))?;

    Ok(result)
}

/// Get all files for a project.
pub(super) async fn get_project_files(
    store: &super::RagStore,
    project_id: &str,
) -> Result<Vec<crate::rag::types::FileRecord>, String> {
    let conn = store.read_conn().await;

    let mut stmt = conn
        .prepare("SELECT id, project_id, relative_path, file_hash, file_size, modified_at, chunk_count FROM files WHERE project_id = ?1 ORDER BY relative_path")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let files = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(crate::rag::types::FileRecord {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                relative_path: row.get(2)?,
                file_hash: row.get(3)?,
                file_size: row.get::<_, i64>(4)? as u64,
                modified_at: row.get(5)?,
                chunk_count: row.get::<_, i64>(6)? as usize,
            })
        })
        .map_err(|e| format!("Failed to query files: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(files)
}

/// Get tracked files for a project (used for stale file detection).
pub(super) async fn get_stale_files(
    store: &super::RagStore,
    project_id: &str,
) -> Result<Vec<crate::rag::types::FileRecord>, String> {
    // Simply return all tracked files; diff logic is in indexing.rs.
    get_project_files(store, project_id).await
}
