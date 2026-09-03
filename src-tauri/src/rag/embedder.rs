//! Ollama embedding client for RAG.
//!
//! Wraps the `/api/embed` endpoint for batched embedding generation.

use crate::rag::error::RagResult;
use crate::rag::types::RagModelValidation;
use crate::shared::{acquire_global_permit, ollama_endpoint, retry_with_backoff, HTTP_CLIENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tracing;

/// Query-embedding cache. A RAG search is bounded below by the Ollama
/// round-trip in `embed_query`; repeat searches for the same text (retries,
/// context assembly right after a search) skip it entirely.
static QUERY_EMBED_CACHE: OnceLock<Mutex<HashMap<String, Vec<f32>>>> = OnceLock::new();

// ponytail: eviction is clear-at-cap, not per-entry LRU — adequate for a
// single-user desktop app. If hit rate matters, swap in the `lru` crate.
const QUERY_EMBED_CACHE_CAP: usize = 128;

fn query_embed_cache() -> &'static Mutex<HashMap<String, Vec<f32>>> {
    QUERY_EMBED_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Known embedding models that require a task-specific prefix (`search_query:`
/// for queries, `search_document:` for documents).  This is an **exact-match
/// allowlist** rather than a substring match on "nomic" so that custom
/// fine-tunes or unrelated models whose names happen to contain "nomic" are
/// not incorrectly prefixed.
const PREFIX_MODELS: &[&str] = &[
    "nomic-embed-text",
    "nomic-embed-text-v1",
    "nomic-embed-text-v1.5",
    "nomic-embed-text-v2-moe",
];

/// Returns true if `model` is a known model that requires the
/// `search_query:` / `search_document:` prefix on embedding inputs.
fn needs_prefix(model: &str) -> bool {
    let lower = model.to_lowercase();
    PREFIX_MODELS.iter().any(|m| lower == *m)
}

/// Progress callback for batched embedding: `(batch_index, total_batches, chunks_embedded)`.
type EmbedProgressFn = Box<dyn Fn(usize, usize, usize) + Send + Sync>;

/// Default batch size for embedding requests.
const DEFAULT_BATCH_SIZE: usize = 64;

/// Maximum number of retries for embedding calls.
const EMBED_MAX_RETRIES: u32 = 3;

/// Initial backoff in milliseconds for embedding retries.
const EMBED_BACKOFF_MS: u64 = 1000;

// ====================== REQUEST / RESPONSE TYPES ======================

#[derive(Debug, Serialize)]
struct EmbedRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
    #[allow(dead_code)]
    total_duration: Option<u64>,
    #[allow(dead_code)]
    load_duration: Option<u64>,
    #[allow(dead_code)]
    prompt_eval_count: Option<u32>,
}

// ====================== EMBEDDER ======================

pub struct OllamaEmbedder {
    base_url: String,
    model: String,
    batch_size: usize,
    dimension: Option<usize>,
}

impl OllamaEmbedder {
    pub fn new(base_url: &str, model: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            model: model.to_string(),
            batch_size: DEFAULT_BATCH_SIZE,
            dimension: None,
        }
    }

    /// Embed a single text (for query embedding).
    pub async fn embed_query(&self, text: &str) -> RagResult<Vec<f32>> {
        let input = if needs_prefix(&self.model) {
            format!("search_query: {}", text)
        } else {
            text.to_string()
        };

        // \x1f separates key fields so model/base_url text can never collide.
        let cache_key = format!("{}\u{1f}{}\u{1f}{}", self.base_url, self.model, input);
        if let Some(hit) = query_embed_cache()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&cache_key)
        {
            return Ok(hit.clone());
        }

        let embedding = self.embed_query_uncached(&input).await?;

        let mut cache = query_embed_cache()
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if cache.len() >= QUERY_EMBED_CACHE_CAP {
            cache.clear();
        }
        cache.insert(cache_key, embedding.clone());

        Ok(embedding)
    }

    /// Embed a query text without touching the cache. Used by
    /// `detect_dimension` and `validate`, which exist to probe the server —
    /// answering those from cache would report a dead model as healthy.
    async fn embed_query_uncached(&self, input: &str) -> RagResult<Vec<f32>> {
        let results = self.embed_batch_internal(vec![input.to_string()]).await?;
        results.into_iter().next().ok_or_else(|| {
            crate::rag::error::RagError::EmbedFailed("No embedding returned".to_string())
        })
    }

    /// Embed a batch of texts (for indexing).
    pub async fn embed_batch(&self, texts: Vec<String>) -> RagResult<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let inputs = if needs_prefix(&self.model) {
            texts
                .into_iter()
                .map(|t| format!("search_document: {}", t))
                .collect()
        } else {
            texts
        };

        self.embed_batch_internal(inputs).await
    }

    /// Internal helper for embedding after prefixing.
    async fn embed_batch_internal(&self, texts: Vec<String>) -> RagResult<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let _permit = acquire_global_permit()
            .await
            .map_err(|e| crate::rag::error::RagError::Http(e.to_string()))?;

        let endpoint = ollama_endpoint(&self.base_url, "api/embed").map_err(|e| {
            crate::rag::error::RagError::Config(format!("Invalid Ollama URL: {}", e))
        })?;

        let request = EmbedRequest {
            model: self.model.clone(),
            input: texts,
        };

        let body_str = serde_json::to_string(&request)?;

        let response = retry_with_backoff(
            || {
                let body = body_str.clone();
                let client = &HTTP_CLIENT;
                let url = &endpoint;
                async move {
                    client
                        .post(url)
                        .header("Content-Type", "application/json")
                        .body(body)
                        .send()
                        .await
                }
            },
            EMBED_MAX_RETRIES,
            EMBED_BACKOFF_MS,
        )
        .await
        .map_err(|e| {
            crate::rag::error::RagError::Http(format!("Embedding request failed: {}", e))
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|e| {
                tracing::warn!("Failed to read embedding error response body: {}", e);
                String::new()
            });
            return Err(crate::rag::error::RagError::EmbedFailed(format!(
                "Embedding request returned status {}: {}",
                status, body
            )));
        }

        let embed_response: EmbedResponse = response.json().await.map_err(|e| {
            crate::rag::error::RagError::EmbedFailed(format!(
                "Failed to parse embedding response: {}",
                e
            ))
        })?;

        // Detect dimension from first response
        if self.dimension.is_none() {
            if let Some(first) = embed_response.embeddings.first() {
                tracing::info!(
                    "Detected embedding dimension: {} for model {}",
                    first.len(),
                    self.model
                );
            }
        }

        Ok(embed_response.embeddings)
    }

    /// Embed many chunks with automatic batching.
    /// Calls `progress_fn` after each batch with (batch_index, total_batches, chunks_embedded).
    pub async fn embed_chunks(
        &mut self,
        chunks: Vec<String>,
        progress_fn: Option<EmbedProgressFn>,
    ) -> RagResult<Vec<Vec<f32>>> {
        if chunks.is_empty() {
            return Ok(vec![]);
        }

        let total_batches = chunks.len().div_ceil(self.batch_size);
        let mut all_embeddings = Vec::with_capacity(chunks.len());

        for (batch_idx, batch_start) in (0..chunks.len()).step_by(self.batch_size).enumerate() {
            let batch_end = std::cmp::min(batch_start + self.batch_size, chunks.len());
            let batch: Vec<String> = chunks[batch_start..batch_end].to_vec();

            let embeddings = self.embed_batch(batch).await?;
            all_embeddings.extend(embeddings);

            // Detect dimension from first batch
            if self.dimension.is_none() && !all_embeddings.is_empty() {
                self.dimension = Some(all_embeddings[0].len());
            }

            if let Some(ref cb) = progress_fn {
                cb(batch_idx + 1, total_batches, all_embeddings.len());
            }
        }

        Ok(all_embeddings)
    }

    /// Detect the embedding dimension from the model by embedding a test string.
    pub async fn detect_dimension(&mut self) -> RagResult<usize> {
        if let Some(dim) = self.dimension {
            return Ok(dim);
        }

        // Deliberately uncached: this probes the model, so it must hit the
        // server even if an identical query embedding was cached.
        let embedding = self.embed_batch(vec!["test".to_string()]).await?;
        let embedding = embedding.into_iter().next().ok_or_else(|| {
            crate::rag::error::RagError::EmbedFailed("No embedding returned".to_string())
        })?;
        let dim = embedding.len();
        self.dimension = Some(dim);
        Ok(dim)
    }

    /// Get the detected dimension (if any).
    pub fn dimension(&self) -> Option<usize> {
        self.dimension
    }

    /// Validate that the model supports embeddings by trying to embed a test string.
    pub async fn validate(&self) -> RagResult<RagModelValidation> {
        // Deliberately uncached: validation exists to prove the server and
        // model are responsive right now; a cached hit would lie.
        let probe = if needs_prefix(&self.model) {
            "search_query: validation test".to_string()
        } else {
            "validation test".to_string()
        };
        match self.embed_query_uncached(&probe).await {
            Ok(embedding) => Ok(RagModelValidation {
                is_valid: true,
                model_name: self.model.clone(),
                embedding_dimension: Some(embedding.len()),
                error: None,
            }),
            Err(e) => Ok(RagModelValidation {
                is_valid: false,
                model_name: self.model.clone(),
                embedding_dimension: None,
                error: Some(e.to_string()),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedder_creation() {
        let embedder = OllamaEmbedder::new("http://localhost:11434", "nomic-embed-text-v2-moe");
        assert_eq!(embedder.model, "nomic-embed-text-v2-moe");
        assert_eq!(embedder.batch_size, DEFAULT_BATCH_SIZE);
        assert!(embedder.dimension.is_none());
    }

    #[test]
    fn test_model_validation_serialization() {
        let validation = RagModelValidation {
            is_valid: true,
            model_name: "nomic-embed-text-v2-moe".to_string(),
            embedding_dimension: Some(768),
            error: None,
        };
        let json = serde_json::to_string(&validation).unwrap();
        assert!(json.contains("\"isValid\":true"));
        assert!(json.contains("\"embeddingDimension\":768"));
    }

    #[test]
    fn test_needs_prefix_known_nomic_models() {
        assert!(needs_prefix("nomic-embed-text"));
        assert!(needs_prefix("nomic-embed-text-v1"));
        assert!(needs_prefix("nomic-embed-text-v1.5"));
        assert!(needs_prefix("nomic-embed-text-v2-moe"));
        // Case-insensitive
        assert!(needs_prefix("NOMIC-EMBED-TEXT"));
        assert!(needs_prefix("Nomic-Embed-Text-v2-MoE"));
    }

    #[test]
    fn test_needs_prefix_rejects_substring_match() {
        // The old `contains("nomic")` logic would have matched these;
        // the allowlist must NOT.
        assert!(!needs_prefix("my-nomic-finetune"));
        assert!(!needs_prefix("nomic-code"));
        assert!(!needs_prefix("bge-m3"));
        assert!(!needs_prefix("mxbai-embed-large"));
        assert!(!needs_prefix("all-MiniLM-L6-v2"));
    }
}
