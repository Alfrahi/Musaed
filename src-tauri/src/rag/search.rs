//! Vector search and hybrid ranking for RAG.
//!
//! Combines sqlite-vec vector similarity with BM25 keyword matching for
//! high-quality retrieval. Context assembly is handled by `context_assembler.rs`.

use crate::rag::bm25::BM25;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::error::RagResult;
use crate::rag::store::RagStore;
use crate::rag::types::SearchResult;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing;

/// Default number of results to return.
const DEFAULT_TOP_K: usize = 10;

/// Default minimum cosine similarity threshold.
/// 0.1 let near-random chunks through; 0.3 keeps weak matches out of the
/// assembled context so they stop eating the char budget (RAG R2).
const DEFAULT_THRESHOLD: f32 = 0.3;

/// Weight for vector similarity in hybrid scoring.
const VECTOR_WEIGHT: f32 = 0.6;

/// Weight for BM25 score in hybrid scoring.
const BM25_WEIGHT: f32 = 0.4;

/// Saturation constant for BM25 normalization: `score / (score + k)`.
/// Maps raw BM25 scores (unbounded, typically 0..~20) monotonically into
/// [0, 1) while preserving relative magnitude. Chosen so a strong lexical
/// match (raw score ~5) lands near 0.8 and a weak one (~0.5) near 0.3.
const BM25_SATURATION_K: f32 = 1.5;

// ====================== SEARCH ENGINE ======================

pub struct RagSearchEngine;

impl RagSearchEngine {
    /// Search for relevant chunks given a natural language query.
    pub async fn search(
        store: Arc<RwLock<RagStore>>,
        project_id: &str,
        query: &str,
        base_url: &str,
        embedding_model: &str,
        top_k: Option<usize>,
        threshold: Option<f32>,
    ) -> RagResult<Vec<SearchResult>> {
        let top_k = top_k.unwrap_or(DEFAULT_TOP_K);
        let threshold = threshold.unwrap_or(DEFAULT_THRESHOLD);

        tracing::debug!(
            "RAG Search: project={}, query='{}', model={}, threshold={}",
            project_id,
            query,
            embedding_model,
            threshold
        );

        // Embed the query via Ollama (no store lock held across this network
        // call).
        let embedder = OllamaEmbedder::new(base_url, embedding_model);
        let query_embedding = embedder.embed_query(query).await?;

        // Vector search in SQLite — brief read guard only for the vector
        // lookup; the BM25 rerank below runs on the owned candidate list
        // without holding the lock so the pool slot is released.
        //
        // Also pull corpus-wide lexical (FTS5) candidates under the same
        // guard: pure keyword matches the embedding model ranked below the
        // vector window are rescued into the hybrid pool here (RAG R1).
        let candidates = {
            let s = store.read().await;
            let mut pool = s
                .search_similar(project_id, &query_embedding, top_k * 2, threshold)
                .await?;

            match s.search_lexical(project_id, query, top_k * 2).await {
                Ok(lexical) => {
                    for hit in lexical {
                        // Keep the strong vector score on overlap; lexical-only
                        // candidates enter with score 0 so the BM25 leg
                        // decides their hybrid placement.
                        if !pool.iter().any(|c| c.chunk_id == hit.chunk_id) {
                            pool.push(SearchResult { score: 0.0, ..hit });
                        }
                    }
                }
                Err(e) => {
                    // Lexical leg is additive — vector-only search still works.
                    tracing::warn!("RAG Search: lexical candidate lookup failed: {}", e);
                }
            }
            pool
        };

        tracing::debug!("RAG Search: found {} vector candidates", candidates.len());

        // If no candidates, return early
        if candidates.is_empty() {
            tracing::info!("RAG Search: no candidates found for query '{}'", query);
            return Ok(vec![]);
        }

        tracing::info!(
            "RAG Search: found {} candidates for query '{}'",
            candidates.len(),
            query
        );

        // BM25 rerank — no store lock held. Score against the *whole project
        // corpus* (not the per-query candidate window) so IDF and length
        // normalization are stable and comparable across queries.
        let corpus_stats = store.read().await.load_corpus_stats(project_id).await?;

        let documents: Vec<(usize, String)> = candidates
            .iter()
            .map(|c| (c.chunk_id as usize, c.content.clone()))
            .collect();

        // Initialize BM25 from corpus statistics.
        let bm25 = BM25::from_corpus(&documents, &corpus_stats);

        // Compute BM25 scores for each candidate.
        let bm25_scores: Vec<f32> = candidates
            .iter()
            .map(|c| {
                let score = bm25.score(query, c.chunk_id as usize);
                if score.is_finite() {
                    score
                } else {
                    tracing::warn!(
                        "RAG Search: non-finite BM25 score ({}) for chunk {}, falling back to 0.0",
                        score,
                        c.chunk_id
                    );
                    0.0
                }
            })
            .collect();

        // Rerank candidates using hybrid scoring (vector + BM25).
        //
        // BM25 is normalized with a *saturating* transform (score / (score +
        // k)) rather than min-max over the candidate window. Min-max forces
        // the top candidate to 1.0 and the bottom to 0.0 regardless of how
        // weak the actual match is, which made the 0.4 lexical weight
        // non-comparable across queries. The saturating form is monotonic,
        // bounded to [0, 1), and preserves the magnitude of the raw score.
        let mut reranked = candidates
            .into_iter()
            .zip(bm25_scores)
            .map(|(mut candidate, bm25_score)| {
                let normalized_bm25 = bm25_score / (bm25_score + BM25_SATURATION_K);
                let hybrid = VECTOR_WEIGHT * candidate.score + BM25_WEIGHT * normalized_bm25;
                candidate.score = if hybrid.is_finite() {
                    hybrid
                } else {
                    tracing::warn!(
                        "RAG Search: non-finite hybrid score for chunk {}, falling back to 0.0",
                        candidate.chunk_id
                    );
                    0.0
                };
                candidate
            })
            .collect::<Vec<_>>();

        // Sort by hybrid score with deterministic tiebreaker
        reranked.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.chunk_id.cmp(&b.chunk_id))
        });

        // Return top_k results
        Ok(reranked.into_iter().take(top_k).collect())
    }
}
