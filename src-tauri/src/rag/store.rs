//! SQLite + sqlite-vec vector store wrapper for RAG.
//!
//! Manages the database schema, CRUD operations for projects, files, chunks,
//! and vector similarity search via the `sqlite-vec` extension.

use crate::rag::types::{
    ChunkRecord, ChunkRow, FileRecord, ProjectStats, ProjectStatus, RagProject, SearchResult,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::Mutex;

/// Default embedding vector dimension. Will be overridden per-project after
/// the first embedding call detects the actual dimension.
const DEFAULT_EMBEDDING_DIMENSION: usize = 768;

/// Maximum embedding dimension supported by the vec_chunks virtual table.
/// Shorter vectors are zero-padded to this length.
const MAX_EMBEDDING_DIMENSION: usize = 4096;


// ====================== SCHEMA ======================

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    path            TEXT NOT NULL UNIQUE,
    embedding_model TEXT NOT NULL,
    ignore_patterns TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    indexed_at      TEXT,
    file_count      INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    total_bytes     INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle',
    embedding_dimension INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    relative_path   TEXT NOT NULL,
    file_hash       TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    modified_at     TEXT NOT NULL,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, relative_path)
);

CREATE TABLE IF NOT EXISTS chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    chunk_type      TEXT NOT NULL DEFAULT 'text',
    language        TEXT,
    start_line      INTEGER,
    end_line        INTEGER,
    metadata        TEXT DEFAULT '{}',
    UNIQUE(file_id, chunk_index)
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
    chunk_id  INTEGER PRIMARY KEY,
    embedding float[4096] distance_metric=cosine
);

CREATE INDEX IF NOT EXISTS idx_chunks_project_id ON chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
"#;

const PRAGMAS_SQL: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
"#;

// ====================== RAG STORE ======================

pub struct RagStore {
    conn: Mutex<Connection>,
}

impl RagStore {
    /// Opens (or creates) the RAG SQLite database at the given path.
    /// The parent directory must already exist.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        // Load sqlite-vec extension globally BEFORE opening the connection
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }

        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open RAG database: {}", e))?;

        // Apply pragmas
        conn.execute_batch(PRAGMAS_SQL)
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        // Create schema
        conn.execute_batch(SCHEMA_SQL)
            .map_err(|e| format!("Failed to create RAG schema: {}", e))?;

        // Run migrations
        Self::run_migrations(&conn)?;

        log::info!("RAG database opened at {:?}", db_path);

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Run database migrations for schema changes across versions.
    fn run_migrations(conn: &Connection) -> Result<(), String> {
        // Migration 1: Add `status` column to projects table.
        // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check first.
        let has_status_column: bool = conn
            .prepare("SELECT status FROM projects LIMIT 0")
            .is_ok();
        if !has_status_column {
            conn.execute(
                "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'",
                [],
            )
            .map_err(|e| format!("Migration: failed to add status column: {}", e))?;
            log::info!("Migration: added status column to projects table");
        }

        // Migration 2: Recreate vec_chunks with cosine distance metric.
        // The original schema used the default L2 metric, which produces
        // meaningless similarity scores when treated as cosine distance.
        // This migration drops and recreates the virtual table. Existing
        // embeddings are lost — projects must be re-indexed.
        let needs_vec_rebuild: bool = {
            // Check if vec_chunks exists with the old L2 metric by inspecting
            // whether the distance values ever exceed 2.0 (cosine max).
            // Simpler heuristic: check if the table was created without the
            // distance_metric flag by trying a test query.
            let vec_exists: bool = conn
                .prepare("SELECT chunk_id, embedding FROM vec_chunks LIMIT 1")
                .is_ok();
            if !vec_exists {
                false
            } else {
                // Check a flag table to see if we already migrated
                let migrated: bool = conn
                    .query_row(
                        "SELECT value FROM _rag_migrations WHERE name = 'vec_cosine_metric'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                    .map(|v| v == "1")
                    .unwrap_or(false);
                !migrated
            }
        };

        if needs_vec_rebuild {
            log::warn!("Migration: rebuilding vec_chunks with cosine distance metric. Existing embeddings will be lost.");
            conn.execute_batch(
                "DROP TABLE IF EXISTS vec_chunks;
                 CREATE VIRTUAL TABLE vec_chunks USING vec0(
                     chunk_id  INTEGER PRIMARY KEY,
                     embedding float[4096] distance_metric=cosine
                 );
                 CREATE TABLE IF NOT EXISTS _rag_migrations (name TEXT PRIMARY KEY, value TEXT);
                 INSERT OR REPLACE INTO _rag_migrations (name, value) VALUES ('vec_cosine_metric', '1');",
            )
            .map_err(|e| format!("Migration: failed to rebuild vec_chunks: {}", e))?;

            // Reset project stats since embeddings are gone
            conn.execute(
                "UPDATE projects SET chunk_count = 0, indexed_at = NULL WHERE 1",
                [],
            )
            .map_err(|e| format!("Migration: failed to reset project stats: {}", e))?;

            log::info!("Migration: vec_chunks rebuilt with cosine metric");
        }

        // Ensure the migration tracking table exists for future migrations
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _rag_migrations (name TEXT PRIMARY KEY, value TEXT);
             INSERT OR IGNORE INTO _rag_migrations (name, value) VALUES ('vec_cosine_metric', '1');",
        )
        .map_err(|e| format!("Migration: failed to ensure migration tracking: {}", e))?;

        Ok(())
    }

    // ====================== PROJECT CRUD ======================

    pub fn create_project(&self, project: &RagProject) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO projects (id, name, path, embedding_model, ignore_patterns, created_at, updated_at, indexed_at, file_count, chunk_count, total_bytes, status, embedding_dimension)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                project.id,
                project.name,
                project.path,
                project.embedding_model,
                serde_json::to_string(&project.ignore_patterns).unwrap_or_else(|_| "[]".to_string()),
                project.created_at,
                project.updated_at,
                project.indexed_at,
                project.file_count as i64,
                project.chunk_count as i64,
                project.total_bytes as i64,
                project.status.as_str(),
                DEFAULT_EMBEDDING_DIMENSION as i64,
            ],
        )
        .map_err(|e| format!("Failed to create project: {}", e))?;
        Ok(())
    }

    /// Creates a new project from raw parameters, handling ID generation,
    /// timestamping, path canonicalization, and assembly. This moves business
    /// logic out of Tauri commands to satisfy the "thin adapter" rule.
    pub async fn create_project_with_params(
        &self,
        name: &str,
        path: &str,
        embedding_model: &str,
        ignore_patterns: &[String],
    ) -> Result<RagProject, String> {
        // Resolve and validate the project path
        let p = Path::new(path);
        let canonical_path = p.canonicalize()
            .map_err(|e| format!("Path does not exist or is not accessible: {}", e))?;
        if !canonical_path.is_dir() {
            return Err(format!("Path is not a directory: {:?}", canonical_path));
        }
        let canonical_path_str = canonical_path.to_string_lossy().to_string();

        // Generate ID and timestamps
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Assemble project struct
        let project = RagProject {
            id: id.clone(),
            name: name.to_string(),
            path: canonical_path_str,
            embedding_model: embedding_model.to_string(),
            ignore_patterns: ignore_patterns.to_vec(),
            created_at: now.clone(),
            updated_at: now,
            indexed_at: None,
            file_count: 0,
            chunk_count: 0,
            total_bytes: 0,
            status: ProjectStatus::Idle,
        };

        // Persist to database
        self.create_project(&project)?;

        Ok(project)
    }

    pub fn get_project(&self, id: &str) -> Result<Option<RagProject>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT * FROM projects WHERE id = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let result = stmt
            .query_row(params![id], |row| Self::row_to_project(row))
            .optional()
            .map_err(|e| format!("Failed to query project: {}", e))?;

        Ok(result)
    }

    pub fn list_projects(&self) -> Result<Vec<RagProject>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let projects = stmt
            .query_map([], |row| Self::row_to_project(row))
            .map_err(|e| format!("Failed to query projects: {}", e))?
            .filter_map(|p| p.ok())
            .collect();

        Ok(projects)
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Delete embeddings using subquery
        conn.execute(
            "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE project_id = ?1)",
            params![id],
        )
        .map_err(|e| format!("Failed to delete embeddings: {}", e))?;

        // CASCADE will handle chunks and files
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete project: {}", e))?;

        Ok(())
    }

    pub fn update_project_metadata(
        &self,
        id: &str,
        name: Option<&str>,
        ignore_patterns: Option<&[String]>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(n) = name {
            conn.execute(
                "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![n, now, id],
            )
            .map_err(|e| format!("Failed to update project name: {}", e))?;
        }

        if let Some(patterns) = ignore_patterns {
            let patterns_json =
                serde_json::to_string(patterns).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                "UPDATE projects SET ignore_patterns = ?1, updated_at = ?2 WHERE id = ?3",
                params![patterns_json, now, id],
            )
            .map_err(|e| format!("Failed to update ignore patterns: {}", e))?;
        }

        Ok(())
    }

    pub fn update_project_stats(
        &self,
        id: &str,
        file_count: u64,
        chunk_count: u64,
        total_bytes: u64,
        indexed_at: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE projects SET file_count = ?1, chunk_count = ?2, total_bytes = ?3, indexed_at = ?4, updated_at = ?5 WHERE id = ?6",
            params![file_count as i64, chunk_count as i64, total_bytes as i64, indexed_at, now, id],
        )
        .map_err(|e| format!("Failed to update project stats: {}", e))?;

        Ok(())
    }

    pub fn set_embedding_dimension(&self, id: &str, dimension: usize) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE projects SET embedding_dimension = ?1 WHERE id = ?2",
            params![dimension as i64, id],
        )
        .map_err(|e| format!("Failed to update embedding dimension: {}", e))?;
        Ok(())
    }

    pub fn get_embedding_dimension(&self, id: &str) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let dimension: i64 = conn
            .query_row(
                "SELECT embedding_dimension FROM projects WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to get embedding dimension: {}", e))?;
        Ok(dimension as usize)
    }

    pub fn set_status(&self, id: &str, status: &ProjectStatus) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status.as_str(), now, id],
        )
        .map_err(|e| format!("Failed to update project status: {}", e))?;
        Ok(())
    }

    pub fn update_embedding_model(&self, id: &str, model: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE projects SET embedding_model = ?1, updated_at = ?2 WHERE id = ?3",
            params![model, now, id],
        )
        .map_err(|e| format!("Failed to update embedding model: {}", e))?;
        Ok(())
    }

    // ====================== FILE CRUD ======================

    pub fn upsert_file(&self, file: &FileRecord) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Check if file already exists for this project
        let existing_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM files WHERE project_id = ?1 AND relative_path = ?2",
                params![file.project_id, file.relative_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query file: {}", e))?;

        if let Some(id) = existing_id {
            // Update existing file
            conn.execute(
                "UPDATE files SET file_hash = ?1, file_size = ?2, modified_at = ?3, chunk_count = ?4 WHERE id = ?5",
                params![file.file_hash, file.file_size as i64, file.modified_at, file.chunk_count as i64, id],
            )
            .map_err(|e| format!("Failed to update file: {}", e))?;
            Ok(id)
        } else {
            // Insert new file
            conn.execute(
                "INSERT INTO files (project_id, relative_path, file_hash, file_size, modified_at, chunk_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![file.project_id, file.relative_path, file.file_hash, file.file_size as i64, file.modified_at, file.chunk_count as i64],
            )
            .map_err(|e| format!("Failed to insert file: {}", e))?;
            Ok(conn.last_insert_rowid())
        }
    }

    pub fn delete_file(&self, file_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Delete embeddings using subquery
        conn.execute(
            "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
            params![file_id],
        )
        .map_err(|e| format!("Failed to delete embeddings: {}", e))?;

        // CASCADE will handle chunks, but delete explicitly for safety
        conn.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])
            .map_err(|e| format!("Failed to delete chunks: {}", e))?;

        conn.execute("DELETE FROM files WHERE id = ?1", params![file_id])
            .map_err(|e| format!("Failed to delete file: {}", e))?;

        Ok(())
    }

    pub fn get_file_by_path(
        &self,
        project_id: &str,
        relative_path: &str,
    ) -> Result<Option<FileRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, project_id, relative_path, file_hash, file_size, modified_at, chunk_count FROM files WHERE project_id = ?1 AND relative_path = ?2")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let result = stmt
            .query_row(params![project_id, relative_path], |row| {
                Ok(FileRecord {
                    id: Some(row.get(0)?),
                    project_id: row.get(1)?,
                    relative_path: row.get(2)?,
                    file_hash: row.get(3)?,
                    file_size: row.get::<_, i64>(4)? as u64,
                    modified_at: row.get(5)?,
                    chunk_count: row.get::<_, i64>(6)? as usize,
                })
            })
            .optional()
            .map_err(|e| format!("Failed to query file: {}", e))?;

        Ok(result)
    }

    pub fn get_project_files(&self, project_id: &str) -> Result<Vec<FileRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, project_id, relative_path, file_hash, file_size, modified_at, chunk_count FROM files WHERE project_id = ?1 ORDER BY relative_path")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let files = stmt
            .query_map(params![project_id], |row| {
                Ok(FileRecord {
                    id: Some(row.get(0)?),
                    project_id: row.get(1)?,
                    relative_path: row.get(2)?,
                    file_hash: row.get(3)?,
                    file_size: row.get::<_, i64>(4)? as u64,
                    modified_at: row.get(5)?,
                    chunk_count: row.get::<_, i64>(6)? as usize,
                })
            })
            .map_err(|e| format!("Failed to query files: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(files)
    }

    /// Get tracked files whose hash differs from the stored hash, or that no
    /// longer exist on disk (stale), for incremental indexing.
    pub fn get_stale_files(&self, project_id: &str) -> Result<Vec<FileRecord>, String> {
        // This is a helper — the actual diff logic is in indexing.rs.
        // Here we just return all tracked files for the project.
        self.get_project_files(project_id)
    }

    // ====================== CHUNK CRUD ======================

    pub fn insert_chunk(&self, chunk: &ChunkRow) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO chunks (project_id, file_id, chunk_index, content, chunk_type, language, start_line, end_line, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                chunk.project_id,
                chunk.file_id,
                chunk.chunk_index as i64,
                chunk.content,
                chunk.chunk_type,
                chunk.language,
                chunk.start_line as i64,
                chunk.end_line as i64,
                serde_json::to_string(&chunk.metadata).unwrap_or_else(|_| "{}".to_string()),
            ],
        )
        .map_err(|e| format!("Failed to insert chunk: {}", e))?;

        Ok(conn.last_insert_rowid())
    }

    pub fn insert_chunks_batch(&self, chunks: &[ChunkRow]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO chunks (project_id, file_id, chunk_index, content, chunk_type, language, start_line, end_line, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
            ).map_err(|e| format!("Failed to prepare insert: {}", e))?;

            for chunk in chunks {
                stmt.execute(params![
                    chunk.project_id,
                    chunk.file_id,
                    chunk.chunk_index as i64,
                    chunk.content,
                    chunk.chunk_type,
                    chunk.language,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    serde_json::to_string(&chunk.metadata).unwrap_or_else(|_| "{}".to_string()),
                ])
                .map_err(|e| format!("Failed to insert chunk: {}", e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit chunk batch: {}", e))?;
        Ok(())
    }

    pub fn insert_embedding(&self, chunk_id: i64, embedding: &[f32]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Zero-pad embedding to MAX_EMBEDDING_DIMENSION
        let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
        let copy_len = embedding.len().min(MAX_EMBEDDING_DIMENSION);
        padded[..copy_len].copy_from_slice(&embedding[..copy_len]);

        // Convert to bytes for sqlite-vec
        let bytes: Vec<u8> = padded
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        conn.execute(
            "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)",
            params![chunk_id, bytes],
        )
        .map_err(|e| format!("Failed to insert embedding: {}", e))?;

        Ok(())
    }

    pub fn insert_embeddings_batch(
        &self,
        chunk_ids: &[i64],
        embeddings: &[Vec<f32>],
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        {
            let mut stmt = tx
                .prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)")
                .map_err(|e| format!("Failed to prepare insert: {}", e))?;

            for (chunk_id, embedding) in chunk_ids.iter().zip(embeddings.iter()) {
                let mut padded = vec![0.0f32; MAX_EMBEDDING_DIMENSION];
                let copy_len = embedding.len().min(MAX_EMBEDDING_DIMENSION);
                padded[..copy_len].copy_from_slice(&embedding[..copy_len]);

                let bytes: Vec<u8> = padded.iter().flat_map(|f| f.to_le_bytes()).collect();

                stmt.execute(params![chunk_id, bytes])
                    .map_err(|e| format!("Failed to insert embedding: {}", e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit embedding batch: {}", e))?;
        Ok(())
    }

    /// Delete chunks and their embeddings for a specific file.
    pub fn delete_file_chunks(&self, file_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Delete embeddings using subquery (single statement instead of N+1)
        conn.execute(
            "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?1)",
            params![file_id],
        )
        .map_err(|e| format!("Failed to delete embeddings: {}", e))?;

        // Delete chunks
        conn.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])
            .map_err(|e| format!("Failed to delete chunks: {}", e))?;

        Ok(())
    }

    pub fn get_file_chunks(&self, file_id: i64) -> Result<Vec<ChunkRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, chunk_index, content, chunk_type, language, start_line, end_line, metadata FROM chunks WHERE file_id = ?1 ORDER BY chunk_index")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let chunks = stmt
            .query_map(params![file_id], |row| {
                let metadata_str: String = row.get(7)?;
                Ok(ChunkRecord {
                    id: row.get(0)?,
                    chunk_index: row.get::<_, i64>(1)? as usize,
                    content: row.get(2)?,
                    chunk_type: row.get(3)?,
                    language: row.get(4)?,
                    start_line: row.get::<_, i64>(5)? as usize,
                    end_line: row.get::<_, i64>(6)? as usize,
                    metadata: serde_json::from_str(&metadata_str).unwrap_or(serde_json::json!({})),
                })
            })
            .map_err(|e| format!("Failed to query chunks: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(chunks)
    }

    // ====================== SEARCH ======================

    pub fn search_similar(
        &self,
        project_id: &str,
        query_embedding: &[f32],
        top_k: usize,
        threshold: f32,
    ) -> Result<Vec<SearchResult>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

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

        let mut stmt = conn.prepare(sql).map_err(|e| format!("Failed to prepare search: {}", e))?;

        let results = stmt
            .query_map(
                rusqlite::params![query_bytes, project_id, top_k],
                |row| {
                    let metadata_str: String = row.get(6)?;
                    let distance: f32 = row.get(8)?;
                    Ok(SearchResult {
                        chunk_id: row.get(0)?,
                        content: row.get(1)?,
                        chunk_type: row.get(2)?,
                        language: row.get(3)?,
                        start_line: row.get::<_, i64>(4)? as usize,
                        end_line: row.get::<_, i64>(5)? as usize,
                        metadata: serde_json::from_str(&metadata_str)
                            .unwrap_or(serde_json::json!({})),
                        file_path: row.get(7)?,
                        score: 1.0 - distance, // Convert distance to similarity score
                    })
                },
            )
            .map_err(|e| format!("Failed to execute search: {}", e))?
            .filter_map(|r| r.ok())
            .filter(|r| r.score >= threshold)
            .collect();

        Ok(results)
    }

    // ====================== STATS ======================

    pub fn get_project_stats(&self, project_id: &str) -> Result<ProjectStats, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM files WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count files: {}", e))?;

        let chunk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count chunks: {}", e))?;

        let total_bytes: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(file_size), 0) FROM files WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to sum bytes: {}", e))?;

        let embedding_dimension: i64 = conn
            .query_row(
                "SELECT embedding_dimension FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to get embedding dimension: {}", e))?;

        let last_indexed: Option<String> = conn
            .query_row(
                "SELECT indexed_at FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to get last indexed: {}", e))?
            .flatten();

        // Estimate index size (rough: vectors + metadata)
        let index_size_bytes = (chunk_count as u64) * (MAX_EMBEDDING_DIMENSION as u64 * 4 + 500);

        Ok(ProjectStats {
            file_count: file_count as u64,
            chunk_count: chunk_count as u64,
            total_bytes: total_bytes as u64,
            embedding_dimension: embedding_dimension as usize,
            index_size_bytes,
            last_indexed,
        })
    }

    // ====================== ROW MAPPING ======================

    fn row_to_project(row: &rusqlite::Row<'_>) -> Result<RagProject, rusqlite::Error> {
        let ignore_patterns_str: String = row.get(4)?;
        let ignore_patterns: Vec<String> =
            serde_json::from_str(&ignore_patterns_str).unwrap_or_default();

        // Read status from the column, falling back to derivation from indexed_at
        let status: ProjectStatus = row
            .get::<_, Option<String>>(11)
            .ok()
            .flatten()
            .and_then(|s| match s.as_str() {
                "indexing" => Some(ProjectStatus::Indexing),
                "ready" => Some(ProjectStatus::Ready),
                "error" => Some(ProjectStatus::Error),
                "idle" => Some(ProjectStatus::Idle),
                _ => None,
            })
            .unwrap_or_else(|| {
                // Fallback for rows where status column doesn't exist yet
                if row.get::<_, Option<String>>(7).ok().flatten().is_some() {
                    ProjectStatus::Ready
                } else {
                    ProjectStatus::Idle
                }
            });

        Ok(RagProject {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            embedding_model: row.get(3)?,
            ignore_patterns,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            indexed_at: row.get(7)?,
            file_count: row.get::<_, i64>(8)? as u64,
            chunk_count: row.get::<_, i64>(9)? as u64,
            total_bytes: row.get::<_, i64>(10)? as u64,
            status,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
