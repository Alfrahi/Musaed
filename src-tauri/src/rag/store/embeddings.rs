//! Embedding storage operations.

use super::connection::MAX_EMBEDDING_DIMENSION;

/// Insert a single embedding vector for a chunk.
pub(super) fn insert_embedding(
    store: &super::RagStore,
    chunk_id: i64,
    embedding: &[f32],
) -> Result<(), String> {
    let conn = store.conn.lock().map_err(|e| e.to_string())?;

    // Zero-pad embedding to MAX_EMBEDDING_DIMENSION
    let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
    let copy_len = embedding.len().min(MAX_EMBEDDING_DIMENSION);
    padded[..copy_len].copy_from_slice(&embedding[..copy_len]);

    // Convert to bytes for sqlite-vec
    let bytes: Vec<u8> = padded
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    conn.execute(
        "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)",
        rusqlite::params![chunk_id, bytes],
    )
    .map_err(|e| format!("Failed to insert embedding: {}", e))?;

    Ok(())
}

/// Insert multiple embeddings in a single transaction.
pub(super) fn insert_embeddings_batch(
    store: &super::RagStore,
    chunk_ids: &[i64],
    embeddings: &[Vec<f32>],
) -> Result<(), String> {
    let conn = store.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    {
        let mut stmt = tx
            .prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)")
            .map_err(|e| format!("Failed to prepare insert: {}", e))?;

        for (chunk_id, embedding) in chunk_ids.iter().zip(embeddings.iter()) {
            let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
            let copy_len = embedding.len().min(MAX_EMBEDDING_DIMENSION);
            padded[..copy_len].copy_from_slice(&embedding[..copy_len]);

            let bytes: Vec<u8> = padded.iter().flat_map(|f| f.to_le_bytes()).collect();

            stmt.execute(rusqlite::params![chunk_id, bytes])
                .map_err(|e| format!("Failed to insert embedding: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit embedding batch: {}", e))?;
    Ok(())
}

/// Delete embeddings for all chunks of a file (via subquery).
pub(super) fn delete_embeddings_for_chunks_of_file(
    store: &super::RagStore,
    file_id: i64,
) -> Result<(), String> {
    let conn = store.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
        rusqlite::params![file_id],
    )
    .map_err(|e| format!("Failed to delete embeddings: {}", e))?;
    Ok(())
}
