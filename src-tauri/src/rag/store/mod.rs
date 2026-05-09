//! RAG SQLite + sqlite-vec vector store wrapper.
//!
//! Manages the database schema, CRUD operations for projects, files, chunks,
//! and vector similarity search. This module is split into sub-modules for
//! maintainability and testability.

mod connection;
mod projects;
mod files;
mod chunks;
mod embeddings;
mod search_internal;
mod stats;
mod row_mapping;

use std::path::Path;
use std::sync::Mutex;
use crate::rag::types::*;
use connection::open_connection;
use projects::*;
use files::*;
use chunks::*;
use embeddings::*;
use search_internal::*;
use stats::*;

/// The RAG store. Provides thread-safe access via `std::sync::Mutex`.
pub struct RagStore {
    conn: Mutex<rusqlite::Connection>,
}

impl RagStore {
    /// Opens (or creates) the RAG SQLite database at the given path.
    /// The parent directory must already exist.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = open_connection(db_path)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ====================== PROJECT OPERATIONS ======================

    pub fn create_project(&self, project: &RagProject) -> Result<(), String> {
        create_project(self, project)
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

    pub fn get_project(&self, id: &str) -> Result<Option<RagProject>, String> {
        get_project(self, id)
    }

    pub fn list_projects(&self) -> Result<Vec<RagProject>, String> {
        list_projects(self)
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        delete_project(self, id)
    }

    pub fn update_project_metadata(
        &self,
        id: &str,
        name: Option<&str>,
        ignore_patterns: Option<&[String]>,
    ) -> Result<(), String> {
        update_project_metadata(self, id, name, ignore_patterns)
    }

    pub fn update_project_stats(
        &self,
        id: &str,
        file_count: u64,
        chunk_count: u64,
        total_bytes: u64,
        indexed_at: Option<&str>,
    ) -> Result<(), String> {
        update_project_stats(self, id, file_count, chunk_count, total_bytes, indexed_at)
    }

    pub fn get_embedding_dimension(&self, id: &str) -> Result<usize, String> {
        get_embedding_dimension(self, id)
    }

    pub fn set_embedding_dimension(&self, id: &str, dimension: usize) -> Result<(), String> {
        set_embedding_dimension(self, id, dimension)
    }

    pub fn set_status(&self, id: &str, status: &ProjectStatus) -> Result<(), String> {
        set_status(self, id, status)
    }

    pub fn update_embedding_model(&self, id: &str, model: &str) -> Result<(), String> {
        update_embedding_model(self, id, model)
    }

    // ====================== FILE OPERATIONS ======================

    pub fn upsert_file(&self, file: &FileRecord) -> Result<i64, String> {
        upsert_file(self, file)
    }

    pub fn delete_file(&self, file_id: i64) -> Result<(), String> {
        delete_file(self, file_id)
    }

    pub fn get_file_by_path(
        &self,
        project_id: &str,
        relative_path: &str,
    ) -> Result<Option<FileRecord>, String> {
        get_file_by_path(self, project_id, relative_path)
    }

    pub fn get_project_files(&self, project_id: &str) -> Result<Vec<FileRecord>, String> {
        get_project_files(self, project_id)
    }

    pub fn get_stale_files(&self, project_id: &str) -> Result<Vec<FileRecord>, String> {
        get_stale_files(self, project_id)
    }

    // ====================== CHUNK OPERATIONS ======================

    pub fn insert_chunk(&self, chunk: &ChunkRow) -> Result<i64, String> {
        insert_chunk(self, chunk)
    }

    pub fn insert_chunks_batch(&self, chunks: &[ChunkRow]) -> Result<(), String> {
        insert_chunks_batch(self, chunks)
    }

    pub fn get_file_chunks(&self, file_id: i64) -> Result<Vec<ChunkRecord>, String> {
        get_file_chunks(self, file_id)
    }

    pub fn delete_file_chunks(&self, file_id: i64) -> Result<(), String> {
        delete_file_chunks(self, file_id)
    }

    // ====================== EMBEDDING OPERATIONS ======================

    pub fn insert_embedding(&self, chunk_id: i64, embedding: &[f32]) -> Result<(), String> {
        insert_embedding(self, chunk_id, embedding)
    }

    pub fn insert_embeddings_batch(
        &self,
        chunk_ids: &[i64],
        embeddings: &[Vec<f32>],
    ) -> Result<(), String> {
        insert_embeddings_batch(self, chunk_ids, embeddings)
    }

    // ====================== SEARCH OPERATIONS ======================

    pub fn search_similar(
        &self,
        project_id: &str,
        query_embedding: &[f32],
        top_k: usize,
        threshold: f32,
    ) -> Result<Vec<SearchResult>, String> {
        search_similar(self, project_id, query_embedding, top_k, threshold)
    }

    // ====================== STATS ======================

    pub fn get_project_stats(&self, project_id: &str) -> Result<ProjectStats, String> {
        get_project_stats(self, project_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::store::connection::DEFAULT_EMBEDDING_DIMENSION;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_store() -> RagStore {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("musaed_rag_test_{id}"));
        std::fs::create_dir_all(&dir).ok();
        let db_path = dir.join("test_rag.sqlite3");
        // Clean up any previous test db
        std::fs::remove_file(&db_path).ok();
        let store = RagStore::open(&db_path).expect("Failed to open test store");
        // Clean up temp dir when store is dropped
        let dir_clone = dir.clone();
        std::thread::spawn(move || {
            // Best-effort cleanup after a short delay
            std::thread::sleep(std::time::Duration::from_millis(500));
            let _ = std::fs::remove_dir_all(&dir_clone);
        });
        store
    }

    fn make_test_project(id: &str, name: &str, path: &str) -> RagProject {
        RagProject {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            embedding_model: "nomic-embed-text-v2-moe".to_string(),
            ignore_patterns: vec!["node_modules".to_string()],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            indexed_at: None,
            file_count: 0,
            chunk_count: 0,
            total_bytes: 0,
            status: ProjectStatus::Idle,
        }
    }

    #[test]
    fn test_create_and_get_project() {
        let store = test_store();
        let project = make_test_project("proj-1", "My Project", "/tmp/proj");
        store.create_project(&project).unwrap();

        let fetched = store.get_project("proj-1").unwrap();
        assert!(fetched.is_some());
        let fetched = fetched.unwrap();
        assert_eq!(fetched.id, "proj-1");
        assert_eq!(fetched.name, "My Project");
        assert_eq!(fetched.embedding_model, "nomic-embed-text-v2-moe");
        assert_eq!(fetched.ignore_patterns, vec!["node_modules"]);
    }

    #[test]
    fn test_list_projects() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();
        store.create_project(&make_test_project("p2", "B", "/b")).unwrap();

        let projects = store.list_projects().unwrap();
        assert_eq!(projects.len(), 2);
    }

    #[test]
    fn test_delete_project() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();
        store.delete_project("p1").unwrap();
        assert!(store.get_project("p1").unwrap().is_none());
    }

    #[test]
    fn test_update_project_metadata() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();
        store
            .update_project_metadata("p1", Some("Updated"), Some(&["dist".to_string()]))
            .unwrap();

        let project = store.get_project("p1").unwrap().unwrap();
        assert_eq!(project.name, "Updated");
        assert_eq!(project.ignore_patterns, vec!["dist"]);
    }

    #[test]
    fn test_update_project_stats() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();
        store
            .update_project_stats("p1", 100, 500, 1024000, Some("2024-06-01T00:00:00Z"))
            .unwrap();

        let project = store.get_project("p1").unwrap().unwrap();
        assert_eq!(project.file_count, 100);
        assert_eq!(project.chunk_count, 500);
    }

    #[test]
    fn test_upsert_file() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();

        let file = FileRecord {
            id: None,
            project_id: "p1".to_string(),
            relative_path: "src/main.rs".to_string(),
            file_hash: "abc123".to_string(),
            file_size: 1024,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 3,
        };

        let file_id = store.upsert_file(&file).unwrap();
        assert!(file_id > 0);

        // Upsert same file (update)
        let updated = FileRecord {
            id: None,
            file_hash: "def456".to_string(),
            file_size: 2048,
            ..file.clone()
        };
        let same_id = store.upsert_file(&updated).unwrap();
        assert_eq!(file_id, same_id);

        let fetched = store.get_file_by_path("p1", "src/main.rs").unwrap().unwrap();
        assert_eq!(fetched.file_hash, "def456");
        assert_eq!(fetched.file_size, 2048);
    }

    #[test]
    fn test_insert_and_search_chunks() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();

        let file = FileRecord {
            id: None,
            project_id: "p1".to_string(),
            relative_path: "src/main.rs".to_string(),
            file_hash: "abc".to_string(),
            file_size: 100,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 1,
        };
        let file_id = store.upsert_file(&file).unwrap();

        let chunk = ChunkRow {
            id: None,
            project_id: "p1".to_string(),
            file_id,
            chunk_index: 0,
            content: "fn main() {}".to_string(),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: 1,
            end_line: 5,
            metadata: serde_json::json!({"names": ["main"]}),
        };

        let chunk_id = store.insert_chunk(&chunk).unwrap();
        assert!(chunk_id > 0);

        // Insert a dummy embedding (768-dim, non-zero for testing)
        let mut embedding = vec![0.0f32; 768];
        embedding[0] = 1.0;
        store.insert_embedding(chunk_id, &embedding).unwrap();

        // Search with the same vector query
        let mut query = vec![0.0f32; 768];
        query[0] = 1.0;
        let results = store.search_similar("p1", &query, 10, 0.0).unwrap();
        // With identical vectors, distance should be 0 (perfect match)
        assert!(!results.is_empty());
        assert_eq!(results[0].file_path, "src/main.rs");
    }

    #[test]
    fn test_delete_file_cascades() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();

        let file = FileRecord {
            id: None,
            project_id: "p1".to_string(),
            relative_path: "src/lib.rs".to_string(),
            file_hash: "abc".to_string(),
            file_size: 100,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 1,
        };
        let file_id = store.upsert_file(&file).unwrap();

        let chunk = ChunkRow {
            id: None,
            project_id: "p1".to_string(),
            file_id,
            chunk_index: 0,
            content: "struct Foo;".to_string(),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: 1,
            end_line: 1,
            metadata: serde_json::json!({}),
        };

        let chunk_id = store.insert_chunk(&chunk).unwrap();
        let embedding = vec![0.0f32; 768];
        store.insert_embedding(chunk_id, &embedding).unwrap();

        store.delete_file(file_id).unwrap();

        let chunks = store.get_file_chunks(file_id).unwrap();
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_get_project_stats() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();

        let stats = store.get_project_stats("p1").unwrap();
        assert_eq!(stats.file_count, 0);
        assert_eq!(stats.chunk_count, 0);
    }

    #[test]
    fn test_embedding_dimension() {
        let store = test_store();
        store.create_project(&make_test_project("p1", "A", "/a")).unwrap();

        let dim = store.get_embedding_dimension("p1").unwrap();
        assert_eq!(dim, DEFAULT_EMBEDDING_DIMENSION);

        store.set_embedding_dimension("p1", 1024).unwrap();
        let dim = store.get_embedding_dimension("p1").unwrap();
        assert_eq!(dim, 1024);
    }
}
