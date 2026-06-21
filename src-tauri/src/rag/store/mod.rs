//! RAG SQLite + sqlite-vec vector store wrapper.
//!
//! Manages the database schema, CRUD operations for projects, files, chunks,
//! and vector similarity search. This module is split into sub-modules for
//! maintainability and testability.

mod chunks;
pub mod connection;
mod embeddings;
mod files;
mod projects;
mod row_mapping;
mod search_internal;
mod stats;

use crate::rag::types::*;
use chunks::*;
use connection::open_connection;
use embeddings::*;
use files::*;
use projects::*;
use search_internal::*;
use stats::*;
use std::path::Path;
use tokio::sync::Mutex;

/// The RAG store. Provides async-safe access via `tokio::sync::Mutex`.
pub struct RagStore {
    conn: Mutex<rusqlite::Connection>,
    /// Whether the sqlite-vec extension loaded successfully.
    /// If false, vector operations (embeddings, search) will return an error.
    rag_enabled: bool,
}

impl RagStore {
    /// Opens (or creates) the RAG SQLite database at the given path.
    /// The parent directory must already exist.
    ///
    /// If the sqlite-vec extension fails to load, RAG features (vector
    /// embeddings and similarity search) are disabled and a warning is logged.
    /// The store still opens successfully for basic metadata operations.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        match open_connection(db_path) {
            Ok(conn) => Ok(Self {
                conn: Mutex::new(conn),
                rag_enabled: true,
            }),
            Err(e) => {
                tracing::warn!(
                    "Failed to load sqlite-vec extension: {}. \
                     RAG features (embeddings, similarity search) are disabled.",
                    e
                );
                // Open a basic connection without the vector extension for
                // metadata operations (projects, files, chunks without vectors).
                let conn = rusqlite::Connection::open(db_path)
                    .map_err(|e| format!("Failed to open RAG database: {}", e))?;
                Ok(Self {
                    conn: Mutex::new(conn),
                    rag_enabled: false,
                })
            }
        }
    }

    /// Returns whether RAG vector features are enabled.
    pub fn is_rag_enabled(&self) -> bool {
        self.rag_enabled
    }

    /// Acquires a lock on the database connection.
    /// Use this for operations that need direct connection access.
    pub async fn lock_conn(&self) -> tokio::sync::MutexGuard<'_, rusqlite::Connection> {
        self.conn.lock().await
    }

    // ====================== PROJECT OPERATIONS ======================

    pub async fn create_project(&self, project: &RagProject) -> Result<(), String> {
        create_project(self, project).await
    }

    pub async fn create_project_with_params(
        &self,
        name: &str,
        path: &str,
        embedding_model: &str,
        ignore_patterns: &[String],
    ) -> Result<RagProject, String> {
        create_project_with_params(self, name, path, embedding_model, ignore_patterns).await
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<RagProject>, String> {
        get_project(self, id).await
    }

    pub async fn list_projects(&self) -> Result<Vec<RagProject>, String> {
        list_projects(self).await
    }

    pub async fn delete_project(&self, id: &str) -> Result<(), String> {
        delete_project(self, id).await
    }

    pub async fn update_project_metadata(
        &self,
        id: &str,
        name: Option<&str>,
        ignore_patterns: Option<&[String]>,
    ) -> Result<(), String> {
        update_project_metadata(self, id, name, ignore_patterns).await
    }

    pub async fn update_project_stats(
        &self,
        id: &str,
        file_count: u64,
        chunk_count: u64,
        total_bytes: u64,
        indexed_at: Option<&str>,
    ) -> Result<(), String> {
        update_project_stats(self, id, file_count, chunk_count, total_bytes, indexed_at).await
    }

    pub async fn get_embedding_dimension(&self, id: &str) -> Result<usize, String> {
        get_embedding_dimension(self, id).await
    }

    pub async fn set_embedding_dimension(&self, id: &str, dimension: usize) -> Result<(), String> {
        set_embedding_dimension(self, id, dimension).await
    }

    pub async fn set_status(&self, id: &str, status: &ProjectStatus) -> Result<(), String> {
        set_status(self, id, status).await
    }

    pub async fn update_embedding_model(&self, id: &str, model: &str) -> Result<(), String> {
        update_embedding_model(self, id, model).await
    }

    // ====================== FILE OPERATIONS ======================

    pub async fn upsert_file(&self, file: &FileRecord) -> Result<i64, String> {
        upsert_file(self, file).await
    }

    pub async fn delete_file(&self, file_id: i64) -> Result<(), String> {
        delete_file(self, file_id).await
    }

    pub async fn get_file_by_path(
        &self,
        project_id: &str,
        relative_path: &str,
    ) -> Result<Option<FileRecord>, String> {
        get_file_by_path(self, project_id, relative_path).await
    }

    pub async fn get_project_files(&self, project_id: &str) -> Result<Vec<FileRecord>, String> {
        get_project_files(self, project_id).await
    }

    pub async fn get_stale_files(&self, project_id: &str) -> Result<Vec<FileRecord>, String> {
        get_stale_files(self, project_id).await
    }

    // ====================== CHUNK OPERATIONS ======================

    pub async fn insert_chunk(&self, chunk: &ChunkRow) -> Result<i64, String> {
        insert_chunk(self, chunk).await
    }

    pub async fn insert_chunks_batch(&self, chunks: &[ChunkRow]) -> Result<(), String> {
        insert_chunks_batch(self, chunks).await
    }

    pub async fn get_file_chunks(&self, file_id: i64) -> Result<Vec<ChunkRecord>, String> {
        get_file_chunks(self, file_id).await
    }

    pub async fn delete_file_chunks(&self, file_id: i64) -> Result<(), String> {
        delete_file_chunks(self, file_id).await
    }

    // ====================== EMBEDDING OPERATIONS ======================

    /// Inserts a single embedding vector for a chunk.
    ///
    /// # Errors
    ///
    /// Returns an error if the sqlite-vec extension is not loaded.
    pub async fn insert_embedding(&self, chunk_id: i64, embedding: &[f32]) -> Result<(), String> {
        if !self.rag_enabled {
            return Err("RAG features are disabled: sqlite-vec extension not loaded".to_string());
        }
        insert_embedding(self, chunk_id, embedding).await
    }

    /// Inserts multiple embedding vectors in a batch.
    ///
    /// # Errors
    ///
    /// Returns an error if the sqlite-vec extension is not loaded.
    pub async fn insert_embeddings_batch(
        &self,
        chunk_ids: &[i64],
        embeddings: &[Vec<f32>],
    ) -> Result<(), String> {
        if !self.rag_enabled {
            return Err("RAG features are disabled: sqlite-vec extension not loaded".to_string());
        }
        insert_embeddings_batch(self, chunk_ids, embeddings).await
    }

    // ====================== SEARCH OPERATIONS ======================

    /// Performs a similarity search over chunk embeddings.
    ///
    /// # Errors
    ///
    /// Returns an error if the sqlite-vec extension is not loaded.
    pub async fn search_similar(
        &self,
        project_id: &str,
        query_embedding: &[f32],
        top_k: usize,
        threshold: f32,
    ) -> Result<Vec<SearchResult>, String> {
        if !self.rag_enabled {
            return Err("RAG features are disabled: sqlite-vec extension not loaded".to_string());
        }
        search_similar(self, project_id, query_embedding, top_k, threshold).await
    }

    // ====================== STATS ======================

    pub async fn get_project_stats(&self, project_id: &str) -> Result<ProjectStats, String> {
        get_project_stats(self, project_id).await
    }
}
