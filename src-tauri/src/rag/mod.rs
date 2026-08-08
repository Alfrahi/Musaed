//! RAG (Retrieval-Augmented Generation) module.
//!
//! Provides local, offline project indexing and semantic search capabilities.
//! Files are discovered, chunked, embedded via Ollama, and stored in a local
//! SQLite + sqlite-vec vector store for similarity search.
//!
//! Architecture:
//! - `types.rs`          — Shared payload types
//! - `validation.rs`     — Input validation for all commands
//! - `store.rs`         — SQLite + sqlite-vec vector store wrapper
//! - `chunker.rs`       — Code-aware chunking (tree-sitter), markdown, config, text
//! - `ignore.rs`        — .gitignore-aware file discovery
//! - `embedder.rs`      — Ollama embedding client (batched)
//! - `indexing.rs`      — Full indexing pipeline (discover → chunk → embed → store)
//! - `search.rs`        — Vector search + hybrid reranking
//! - `context_assembler.rs` — RAG context assembly (formatting + token budget)
//! - `bm25.rs`           — BM25 ranking for hybrid search
//! - `commands.rs`      — All RAG Tauri IPC commands

pub mod bm25;
pub mod chunker;
pub mod commands;
pub mod context_assembler;
pub mod embedder;
pub mod ignore;
pub mod indexing;
pub mod search;
pub mod services;
pub mod store;
pub mod types;
pub mod validation;

// Re-export key types
pub use store::connection::DEFAULT_EMBEDDING_DIMENSION;
pub use store::RagStore;
pub use types::*;
