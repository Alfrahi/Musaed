//! RAG database migrations
//!
//! Schema evolution for the RAG SQLite database, expressed as
//! [`MigrationStep`]s so the RAG store shares the same versioning,
//! transactional apply-loop, and rollback machinery as the conversations
//! database. Versions 1..=3 map 1:1 onto the legacy `PRAGMA user_version`
//! steps that lived in `rag/store/connection.rs`:
//!
//! - v1: add `status` column to `projects`
//! - v2: rebuild `vec_chunks` with cosine distance metric
//! - v3: shrink `vec_chunks` to 1024 dims + add `chunks_fts` full-text index
//!
//! Rollback is not supported for RAG steps (embedding rebuilds are
//! one-directional; the index is re-derived from source files on the next
//! indexing pass after any downgrade).

use crate::migrations::MigrationStep;

/// Latest migration version for the RAG database
pub const LATEST_VERSION: u32 = 3;

/// Gets the migration step for a specific version
pub fn get_migration(version: u32) -> Option<MigrationStep> {
    rag_step(version)
}

/// Lists all available migrations
pub fn list_all() -> Vec<MigrationStep> {
    (1..=LATEST_VERSION).filter_map(get_migration).collect()
}

fn rag_step(version: u32) -> Option<MigrationStep> {
    match version {
        // v1: add `status` column to projects. Idempotent-ish: fresh databases
        // created via the full schema SQL already have the column, but
        // `migrate_rag_db` only schedules this step for legacy user_version=0
        // databases where the column is absent. The legacy v0→v1 function had
        // a PRAGMA probe guard; the framework path never re-runs it.
        1 => Some(MigrationStep::irreversible(
            1,
            "Add status column to projects",
            &["ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'"],
        )),
        // v2: rebuild vec_chunks with the cosine distance metric (drops embeddings).
        2 => Some(MigrationStep::irreversible(
            2,
            "Rebuild vec_chunks with cosine distance metric",
            &[
                "DROP TABLE IF EXISTS vec_chunks",
                "CREATE VIRTUAL TABLE vec_chunks USING vec0(
                    chunk_id  INTEGER PRIMARY KEY,
                    embedding float[1024] distance_metric=cosine
                )",
                "UPDATE projects SET chunk_count = 0, indexed_at = NULL WHERE 1",
            ],
        )),
        // v3: shrink vec_chunks to 1024 dims + add corpus-wide chunks_fts.
        3 => Some(MigrationStep::irreversible(
            3,
            "Shrink vec_chunks to 1024 dims, add chunks_fts full-text index",
            &[
                "DROP TABLE IF EXISTS vec_chunks",
                "CREATE VIRTUAL TABLE vec_chunks USING vec0(
                    chunk_id  INTEGER PRIMARY KEY,
                    embedding float[1024] distance_metric=cosine
                )",
                "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                    content,
                    content='chunks',
                    content_rowid='rowid'
                )",
                "CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
                    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
                 END",
                "CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
                    INSERT INTO chunks_fts(chunks_fts, rowid, content)
                    VALUES ('delete', old.rowid, old.content);
                 END",
                "CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
                    INSERT INTO chunks_fts(chunks_fts, rowid, content)
                    VALUES ('delete', old.rowid, old.content);
                    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
                 END",
                "INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')",
                "UPDATE projects SET chunk_count = 0, indexed_at = NULL WHERE 1",
            ],
        )),
        _ => None,
    }
}
