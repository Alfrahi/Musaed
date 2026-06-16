//! RAG database migrations
//!
//! Manages schema evolution for the RAG SQLite database.

use crate::migrations::MigrationStep;

/// Latest migration version for RAG database
pub const LATEST_VERSION: u32 = 3;

/// Gets the migration step for a specific version
pub fn get_migration(version: u32) -> Option<MigrationStep> {
    match version {
        1 => Some(MigrationStep::new(
            1,
            "Initial schema: projects, files, chunks, vec_chunks tables",
            &[
                "CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
                "CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    path TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )",
                "CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    start_line INTEGER NOT NULL,
                    end_line INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
                )",
                "CREATE TABLE IF NOT EXISTS vec_chunks (
                    id TEXT PRIMARY KEY,
                    chunk_id TEXT NOT NULL UNIQUE,
                    embedding BLOB NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
                )",
                "CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id)",
                "CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)",
            ],
            &[
                "DROP TABLE IF EXISTS vec_chunks",
                "DROP TABLE IF EXISTS chunks",
                "DROP TABLE IF EXISTS files",
                "DROP TABLE IF EXISTS projects",
            ],
        )),
        2 => Some(MigrationStep::new(
            2,
            "Add status column to chunks table",
            &[
                "ALTER TABLE chunks ADD COLUMN status TEXT NOT NULL DEFAULT 'indexed'",
                "CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status)",
            ],
            &[
                // Cannot DROP COLUMN in SQLite < 3.35, marked as non-rollbackable
            ],
        )),
        3 => Some(MigrationStep::irreversible(
            3,
            "Rebuild vec_chunks with cosine metric for sqlite-vec",
            &[
                "DROP TABLE IF EXISTS vec_chunks",
                "CREATE TABLE vec_chunks (
                    id TEXT PRIMARY KEY,
                    chunk_id TEXT NOT NULL UNIQUE,
                    embedding BLOB NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
                )",
                // Note: vec_cosine index requires sqlite-vec extension
                // Use regular index for plain SQLite compatibility
                "CREATE INDEX IF NOT EXISTS idx_vec_chunks_embedding
                 ON vec_chunks(embedding)",
            ],
        )),
        _ => None,
    }
}

/// Lists all available migrations
pub fn list_all() -> Vec<MigrationStep> {
    (1..=LATEST_VERSION).filter_map(get_migration).collect()
}
