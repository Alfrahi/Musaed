//! File record CRUD operations.

use crate::rag::error::RagResult;
use rusqlite::OptionalExtension;

/// Upsert a file record. Returns the file ID.
pub(super) async fn upsert_file(
    store: &super::RagStore,
    file: &crate::rag::types::FileRecord,
) -> RagResult<i64> {
    let conn = store.write_conn().await;

    // Check if file already exists for this project
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM files WHERE project_id = ?1 AND relative_path = ?2",
            rusqlite::params![file.project_id, file.relative_path],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = existing_id {
        // Update existing file
        conn.execute(
            "UPDATE files SET file_hash = ?1, file_size = ?2, modified_at = ?3, chunk_count = ?4 WHERE id = ?5",
            rusqlite::params![file.file_hash, file.file_size as i64, file.modified_at, file.chunk_count as i64, id],
        )?;
        Ok(id)
    } else {
        // Insert new file
        conn.execute(
            "INSERT INTO files (project_id, relative_path, file_hash, file_size, modified_at, chunk_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![file.project_id, file.relative_path, file.file_hash, file.file_size as i64, file.modified_at, file.chunk_count as i64],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

/// Delete a file and all its associated chunks and embeddings.
///
/// All three deletions (embeddings, chunks, file) must happen under a **single**
/// lock acquisition to prevent race conditions, and within a **single
/// transaction** so a crash between statements cannot leave the DB in an
/// inconsistent state (orphaned chunks/embeddings for a deleted file).
pub(super) async fn delete_file(store: &super::RagStore, file_id: i64) -> RagResult<()> {
    let conn = store.write_conn().await;
    let tx = conn.unchecked_transaction()?;

    // Delete embeddings first (via subquery for chunks belonging to this file).
    tx.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
        rusqlite::params![file_id],
    )?;

    // Delete chunks explicitly for safety, though CASCADE should handle
    tx.execute(
        "DELETE FROM chunks WHERE file_id = ?1",
        rusqlite::params![file_id],
    )?;

    // Delete file
    tx.execute(
        "DELETE FROM files WHERE id = ?1",
        rusqlite::params![file_id],
    )?;

    tx.commit()?;
    Ok(())
}

/// Get a file by project ID and relative path.
pub(super) async fn get_file_by_path(
    store: &super::RagStore,
    project_id: &str,
    relative_path: &str,
) -> RagResult<Option<crate::rag::types::FileRecord>> {
    let conn = store.read_conn().await;

    let mut stmt = conn
        .prepare("SELECT id, project_id, relative_path, file_hash, file_size, modified_at, chunk_count FROM files WHERE project_id = ?1 AND relative_path = ?2")?;

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
        .optional()?;

    Ok(result)
}

/// Get all files for a project.
pub(super) async fn get_project_files(
    store: &super::RagStore,
    project_id: &str,
) -> RagResult<Vec<crate::rag::types::FileRecord>> {
    let conn = store.read_conn().await;

    let mut stmt = conn
        .prepare("SELECT id, project_id, relative_path, file_hash, file_size, modified_at, chunk_count FROM files WHERE project_id = ?1 ORDER BY relative_path")?;

    let files: Vec<crate::rag::types::FileRecord> = stmt
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
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(files)
}

/// Get tracked files for a project (used for stale file detection).
pub(super) async fn get_stale_files(
    store: &super::RagStore,
    project_id: &str,
) -> RagResult<Vec<crate::rag::types::FileRecord>> {
    // Simply return all tracked files; diff logic is in indexing.rs.
    get_project_files(store, project_id).await
}
