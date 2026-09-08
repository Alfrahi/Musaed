//! Vector similarity search operations.

use super::connection::MAX_EMBEDDING_DIMENSION;
use crate::rag::error::RagResult;
use crate::rag::types::SearchResult;

/// Search for similar chunks using vector similarity.
pub(super) async fn search_similar(
    store: &super::RagStore,
    project_id: &str,
    query_embedding: &[f32],
    top_k: usize,
    threshold: f32,
) -> RagResult<Vec<SearchResult>> {
    let conn = store.read_conn().await;

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

    let mut stmt = conn.prepare(sql)?;

    let results: Vec<SearchResult> = stmt
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
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|r| r.score >= threshold)
        .collect();

    Ok(results)
}

/// Lexical (full-text) search over the *entire* project corpus via the
/// `chunks_fts` FTS5 index — not just the vector top-k window (RAG R1).
///
/// Returned scores map SQLite's built-in BM25 rank (more-negative-is-better)
/// into (0, 1) via [`fts5_rank_to_score`]. Callers fuse these with vector
/// scores; pure keyword matches the embedding model missed surface here.
pub(super) async fn search_lexical(
    store: &super::RagStore,
    project_id: &str,
    query: &str,
    limit: usize,
) -> RagResult<Vec<SearchResult>> {
    let match_query = fts_query(query);
    if match_query.is_empty() {
        return Ok(Vec::new());
    }

    let conn = store.read_conn().await;
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
            bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.rowid = chunks_fts.rowid
        JOIN files f ON f.id = c.file_id
        WHERE chunks_fts MATCH ?1
          AND c.project_id = ?2
        ORDER BY rank
        LIMIT ?3
    "#;

    let mut stmt = conn.prepare(sql)?;
    let results: Vec<SearchResult> = stmt
        .query_map(
            rusqlite::params![match_query, project_id, limit as i64],
            |row| {
                let metadata_str: String = row.get(6)?;
                let rank: f64 = row.get(8)?;
                Ok(SearchResult {
                    chunk_id: row.get(0)?,
                    content: row.get(1)?,
                    chunk_type: row.get(2)?,
                    language: row.get(3)?,
                    start_line: row.get::<_, i64>(4)? as usize,
                    end_line: row.get::<_, i64>(5)? as usize,
                    metadata: serde_json::from_str(&metadata_str).unwrap_or(serde_json::json!({})),
                    file_path: row.get(7)?,
                    score: fts5_rank_to_score(rank),
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

/// Map SQLite FTS5 `bm25()` rank (more-negative-is-better) into a (0, 1)
/// score where a stronger match scores higher.
///
/// The naive `1 / (1 + |rank|)` is inverted: a strong match has a large
/// negative rank, so its `|rank|` is large and the naive form scores it *low*.
/// The complement `|rank| / (1 + |rank|)` is monotonic in match strength and
/// bounded to [0, 1).
fn fts5_rank_to_score(rank: f64) -> f32 {
    let magnitude = rank.abs() as f32;
    magnitude / (1.0 + magnitude)
}

/// Build a safe FTS5 MATCH expression: one double-quoted term per whitespace
/// word, OR'd together. Quoting each term neutralizes MATCH syntax chars.
fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|w| {
            let cleaned: String = w
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("\"{}\"", cleaned.replace('"', "\"\""))
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" OR ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts5_rank_to_score_is_monotonic_in_match_strength() {
        // SQLite bm25() is more-negative-is-better: a stronger match has a
        // larger |rank| and must map to a higher score.
        let weak = fts5_rank_to_score(-1.0);
        let strong = fts5_rank_to_score(-10.0);
        assert!(strong > weak, "strong match must outscore weak match");
        assert!(strong > 0.5, "strong match should score above 0.5");
        // Bounded to [0, 1).
        assert!(weak > 0.0 && weak < 1.0);
        assert!(strong < 1.0);
        assert_eq!(fts5_rank_to_score(0.0), 0.0);
    }
}
