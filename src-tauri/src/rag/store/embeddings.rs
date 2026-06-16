//! Embedding storage operations.

use super::connection::MAX_EMBEDDING_DIMENSION;

/// Insert a single embedding vector for a chunk.
pub(super) async fn insert_embedding(
    store: &super::RagStore,
    chunk_id: i64,
    embedding: &[f32],
) -> Result<(), String> {
    let conn = store.lock_conn().await;

    // Zero-pad embedding to MAX_EMBEDDING_DIMENSION
    let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
    let copy_len = embedding.len().min(MAX_EMBEDDING_DIMENSION);
    padded[..copy_len].copy_from_slice(&embedding[..copy_len]);

    // Convert to bytes for sqlite-vec
    let bytes: Vec<u8> = padded.iter().flat_map(|f| f.to_le_bytes()).collect();

    conn.execute(
        "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)",
        rusqlite::params![chunk_id, bytes],
    )
    .map_err(|e| format!("Failed to insert embedding: {}", e))?;

    Ok(())
}

/// Insert multiple embeddings in a single transaction.
pub(super) async fn insert_embeddings_batch(
    store: &super::RagStore,
    chunk_ids: &[i64],
    embeddings: &[Vec<f32>],
) -> Result<(), String> {
    let conn = store.lock_conn().await;
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
