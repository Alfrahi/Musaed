//! Embedding‑model service module for RAG.
//! Exposes thin‑adapter functions for setting and validating the embedding model.

pub use crate::rag::services::{
    set_embedding_model, validate_embedding_model, SetEmbeddingModelRequest,
    ValidateEmbeddingModelRequest,
};
