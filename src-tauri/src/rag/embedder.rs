//! Ollama embedding client for RAG.
//!
//! Wraps the `/api/embed` endpoint for batched embedding generation.

use crate::rag::types::ModelValidation;
use crate::shared::{acquire_global_permit, ollama_endpoint, retry_with_backoff, HTTP_CLIENT};
use serde::{Deserialize, Serialize};

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
    model: String,
    embeddings: Vec<Vec<f32>>,
    #[allow(dead_code)]
    total_duration: Option<u64>,
    #[allow(dead_code)]
    load_duration: Option<u64>,
    #[allow(dead_code)]
    prompt_eval_count: Option<u64>,
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
    pub async fn embed_query(&self, text: &str) -> Result<Vec<f32>, String> {
        let results = self.embed_batch(vec![text.to_string()]).await?;
        results.into_iter().next().ok_or_else(|| "No embedding returned".to_string())
    }

    /// Embed a batch of texts (for indexing).
    pub async fn embed_batch(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let _permit = acquire_global_permit().await.map_err(|e| e.to_string())?;

        let endpoint = ollama_endpoint(&self.base_url, "api/embed")
            .map_err(|e| format!("Invalid Ollama URL: {}", e))?;

        let request = EmbedRequest {
            model: self.model.clone(),
            input: texts,
        };

        let response = retry_with_backoff(
            || {
                let client = &HTTP_CLIENT;
                let url = &endpoint;
                let body = serde_json::to_string(&request).unwrap();
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
        .map_err(|e| format!("Embedding request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Embedding request returned status {}: {}",
                status, body
            ));
        }

        let embed_response: EmbedResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

        // Detect dimension from first response
        if self.dimension.is_none() {
            if let Some(first) = embed_response.embeddings.first() {
                log::info!(
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
        progress_fn: Option<Box<dyn Fn(usize, usize, usize) + Send + Sync>>,
    ) -> Result<Vec<Vec<f32>>, String> {
        if chunks.is_empty() {
            return Ok(vec![]);
        }

        let total_batches = (chunks.len() + self.batch_size - 1) / self.batch_size;
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
    pub async fn detect_dimension(&mut self) -> Result<usize, String> {
        if let Some(dim) = self.dimension {
            return Ok(dim);
        }

        let embedding = self.embed_query("test").await?;
        let dim = embedding.len();
        self.dimension = Some(dim);
        Ok(dim)
    }

    /// Get the detected dimension (if any).
    pub fn dimension(&self) -> Option<usize> {
        self.dimension
    }

    /// Validate that the model supports embeddings by trying to embed a test string.
    pub async fn validate(&self) -> Result<ModelValidation, String> {
        match self.embed_query("validation test").await {
            Ok(embedding) => Ok(ModelValidation {
                is_valid: true,
                model_name: self.model.clone(),
                embedding_dimension: Some(embedding.len()),
                error: None,
            }),
            Err(e) => Ok(ModelValidation {
                is_valid: false,
                model_name: self.model.clone(),
                embedding_dimension: None,
                error: Some(e),
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
        let validation = ModelValidation {
            is_valid: true,
            model_name: "nomic-embed-text-v2-moe".to_string(),
            embedding_dimension: Some(768),
            error: None,
        };
        let json = serde_json::to_string(&validation).unwrap();
        assert!(json.contains("\"isValid\":true"));
        assert!(json.contains("\"embeddingDimension\":768"));
    }
}
