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
const DEFAULT_THRESHOLD: f32 = 0.1;

/// Weight for vector similarity in hybrid scoring.
const VECTOR_WEIGHT: f32 = 0.6;

/// Weight for BM25 score in hybrid scoring.
const BM25_WEIGHT: f32 = 0.4;

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
        let candidates = {
            let s = store.read().await;
            s.search_similar(project_id, &query_embedding, top_k * 2, threshold)
                .await?
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

        // BM25 rerank — no store lock held.
        let documents: Vec<(usize, String)> = candidates
            .iter()
            .map(|c| (c.chunk_id as usize, c.content.clone()))
            .collect();

        // Initialize BM25
        let bm25 = BM25::new(&documents);

        // Compute BM25 scores and find min/max for normalization
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

        let bm25_min = bm25_scores.iter().cloned().fold(f32::INFINITY, f32::min);
        let bm25_max = bm25_scores
            .iter()
            .cloned()
            .fold(f32::NEG_INFINITY, f32::max);
        let bm25_range = (bm25_max - bm25_min).max(1e-6); // Avoid division by zero

        // Rerank candidates using hybrid scoring (vector + BM25)
        let mut reranked = candidates
            .into_iter()
            .enumerate()
            .map(|(i, mut candidate)| {
                // Min-max normalize BM25 score to [0, 1]
                let normalized_bm25 = (bm25_scores[i] - bm25_min) / bm25_range;
                let normalized_bm25 = if normalized_bm25.is_finite() {
                    normalized_bm25
                } else {
                    tracing::warn!(
                        "RAG Search: non-finite normalized BM25 score for chunk {}, falling back to 0.0",
                        candidate.chunk_id
                    );
                    0.0
                };
                // Combine scores with weights
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
