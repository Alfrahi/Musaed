//! Chunk CRUD operations.

use crate::rag::error::RagResult;
use crate::rag::types::ChunkRow;
use rusqlite::params;

/// Insert a single chunk and return its ID.
pub(super) async fn insert_chunk(store: &super::RagStore, chunk: &ChunkRow) -> RagResult<i64> {
    let conn = store.write_conn().await;
    conn.execute(
        "INSERT INTO chunks (project_id, file_id, chunk_index, content, chunk_type, language, start_line, end_line, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            chunk.project_id,
            chunk.file_id,
            chunk.chunk_index as i64,
            chunk.content,
            chunk.chunk_type,
            chunk.language,
            chunk.start_line as i64,
            chunk.end_line as i64,
            serde_json::to_string(&chunk.metadata)?,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert multiple chunks in a single transaction.
pub(super) async fn insert_chunks_batch(
    store: &super::RagStore,
    chunks: &[ChunkRow],
) -> RagResult<()> {
    let conn = store.write_conn().await;
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO chunks (project_id, file_id, chunk_index, content, chunk_type, language, start_line, end_line, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for chunk in chunks {
            stmt.execute(params![
                chunk.project_id,
                chunk.file_id,
                chunk.chunk_index as i64,
                chunk.content,
                chunk.chunk_type,
                chunk.language,
                chunk.start_line as i64,
                chunk.end_line as i64,
                serde_json::to_string(&chunk.metadata)?,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Get all chunks for a specific file.
pub(super) async fn get_file_chunks(
    store: &super::RagStore,
    file_id: i64,
) -> RagResult<Vec<crate::rag::types::ChunkRecord>> {
    let conn = store.read_conn().await;
    let mut stmt = conn
        .prepare("SELECT id, chunk_index, content, chunk_type, language, start_line, end_line, metadata FROM chunks WHERE file_id = ?1 ORDER BY chunk_index")?;
    let chunks: Vec<crate::rag::types::ChunkRecord> = stmt
        .query_map(params![file_id], |row| {
            let metadata_str: String = row.get(7)?;
            Ok(crate::rag::types::ChunkRecord {
                id: row.get(0)?,
                chunk_index: row.get::<_, i64>(1)? as usize,
                content: row.get(2)?,
                chunk_type: row.get(3)?,
                language: row.get(4)?,
                start_line: row.get::<_, i64>(5)? as usize,
                end_line: row.get::<_, i64>(6)? as usize,
                metadata: serde_json::from_str(&metadata_str).unwrap_or(serde_json::json!({})),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(chunks)
}

/// Delete all chunks for a given file (and their embeddings).
///
/// Both deletions must happen under a **single** lock acquisition to prevent
/// race conditions, and within a **single transaction** so a crash between the
/// two deletes cannot leave orphaned chunks whose embeddings were already
/// removed (or vice versa).
pub(super) async fn delete_file_chunks(store: &super::RagStore, file_id: i64) -> RagResult<()> {
    let conn = store.write_conn().await;
    let tx = conn.unchecked_transaction()?;

    // Delete embeddings first (via subquery)
    tx.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
        params![file_id],
    )?;

    // Delete chunks
    tx.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])?;

    tx.commit()?;
    Ok(())
}
