//! Chunk CRUD operations.

use crate::rag::types::ChunkRow;
use rusqlite::params;

/// Insert a single chunk and return its ID.
pub(super) async fn insert_chunk(store: &super::RagStore, chunk: &ChunkRow) -> Result<i64, String> {
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
            serde_json::to_string(&chunk.metadata).unwrap_or_else(|_| "{}".to_string()),
        ],
    )
    .map_err(|e| format!("Failed to insert chunk: {}", e))?;
    Ok(conn.last_insert_rowid())
}

/// Insert multiple chunks in a single transaction.
pub(super) async fn insert_chunks_batch(
    store: &super::RagStore,
    chunks: &[ChunkRow],
) -> Result<(), String> {
    let conn = store.write_conn().await;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO chunks (project_id, file_id, chunk_index, content, chunk_type, language, start_line, end_line, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .map_err(|e| format!("Failed to prepare insert: {}", e))?;
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
                serde_json::to_string(&chunk.metadata).unwrap_or_else(|_| "{}".to_string()),
            ])
            .map_err(|e| format!("Failed to insert chunk: {}", e))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit chunk batch: {}", e))?;
    Ok(())
}

/// Get all chunks for a specific file.
pub(super) async fn get_file_chunks(
    store: &super::RagStore,
    file_id: i64,
) -> Result<Vec<crate::rag::types::ChunkRecord>, String> {
    let conn = store.read_conn().await;
    let mut stmt = conn
        .prepare("SELECT id, chunk_index, content, chunk_type, language, start_line, end_line, metadata FROM chunks WHERE file_id = ?1 ORDER BY chunk_index")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let chunks = stmt
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
        })
        .map_err(|e| format!("Failed to query chunks: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(chunks)
}

/// Delete all chunks for a given file (and their embeddings).
///
/// Both deletions must happen under a **single** lock acquisition to prevent
/// race conditions.
pub(super) async fn delete_file_chunks(
    store: &super::RagStore,
    file_id: i64,
) -> Result<(), String> {
    let conn = store.write_conn().await;

    // Delete embeddings first (via subquery)
    conn.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
        params![file_id],
    )
    .map_err(|e| format!("Failed to delete embeddings: {}", e))?;

    // Delete chunks
    conn.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])
        .map_err(|e| format!("Failed to delete chunks: {}", e))?;

    Ok(())
}
