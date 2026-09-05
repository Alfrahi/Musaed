//! Chunk CRUD operations.

use super::connection::MAX_EMBEDDING_DIMENSION;
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

/// Insert a file's chunks and their embeddings in a single transaction.
///
/// `embeddings` aligns index-for-index with `chunks`; pass an empty slice to
/// skip embedding writes. Chunk IDs come from `last_insert_rowid` inside the
/// transaction, so a failure rolls back the whole file — no partial chunk
/// state can be persisted (RAG P2, atomic per-file store).
pub(super) async fn insert_chunks_with_embeddings(
    store: &super::RagStore,
    chunks: &[ChunkRow],
    embeddings: &[Vec<f32>],
) -> RagResult<()> {
    let conn = store.write_conn().await;
    let tx = conn.unchecked_transaction()?;
    {
        let mut chunk_stmt = tx.prepare(
            "INSERT INTO chunks (project_id, file_id, chunk_index, content, chunk_type, language, start_line, end_line, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        let mut embed_stmt =
            tx.prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)")?;

        for (i, chunk) in chunks.iter().enumerate() {
            chunk_stmt.execute(params![
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

            if let Some(embedding) = embeddings.get(i) {
                let chunk_id = tx.last_insert_rowid();
                let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
                let copy_len = embedding.len().min(MAX_EMBEDDING_DIMENSION);
                padded[..copy_len].copy_from_slice(&embedding[..copy_len]);
                let bytes: Vec<u8> = padded.iter().flat_map(|f| f.to_le_bytes()).collect();
                embed_stmt.execute(params![chunk_id, bytes])?;
            }
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
