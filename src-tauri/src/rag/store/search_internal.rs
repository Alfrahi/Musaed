//! Vector similarity search operations.

use super::connection::MAX_EMBEDDING_DIMENSION;
use crate::rag::types::SearchResult;

/// Search for similar chunks using vector similarity.
pub(super) fn search_similar(
    store: &super::RagStore,
    project_id: &str,
    query_embedding: &[f32],
    top_k: usize,
    threshold: f32,
) -> Result<Vec<SearchResult>, String> {
    let conn = store.conn.lock().map_err(|e| e.to_string())?;

    // Zero-pad query embedding
    let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
    let copy_len = query_embedding.len().min(MAX_EMBEDDING_DIMENSION);
    padded[..copy_len].copy_from_slice(&query_embedding[..copy_len]);

    let query_bytes: Vec<u8> = padded.iter().flat_map(|f| f.to_le_bytes()).collect();

    // Use sqlite-vec for similarity search with JOIN to get chunk metadata
    let sql = r#"
        SELECT
            c.id,
            c.content,
            c.chunk_type,
            c.language,
            c.start_line,
            c.end_line,
            c.metadata,
            f.relative_path,
            v.distance
        FROM vec_chunks v
        JOIN chunks c ON c.id = v.chunk_id
        JOIN files f ON f.id = c.file_id
        WHERE v.embedding MATCH ?1
          AND c.project_id = ?2
          AND k = ?3
        ORDER BY v.distance
    "#;

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Failed to prepare search: {}", e))?;

    let results = stmt
        .query_map(rusqlite::params![query_bytes, project_id, top_k], |row| {
            let metadata_str: String = row.get(6)?;
            let distance: f32 = row.get(8)?;
            Ok(SearchResult {
                chunk_id: row.get(0)?,
                content: row.get(1)?,
                chunk_type: row.get(2)?,
                language: row.get(3)?,
                start_line: row.get::<_, i64>(4)? as usize,
                end_line: row.get::<_, i64>(5)? as usize,
                metadata: serde_json::from_str(&metadata_str).unwrap_or(serde_json::json!({})),
                file_path: row.get(7)?,
                score: 1.0 - distance, // Convert distance to similarity score
            })
        })
        .map_err(|e| format!("Failed to execute search: {}", e))?
        .filter_map(|r| r.ok())
        .filter(|r| r.score >= threshold)
        .collect();

    Ok(results)
}
