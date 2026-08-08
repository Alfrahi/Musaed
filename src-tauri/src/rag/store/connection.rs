//! Database connection management, schema, and migrations.

use rusqlite::{ffi, Connection};
use std::path::Path;

/// Default embedding vector dimension. Will be overridden per-project after
/// the first embedding call detects the actual dimension.
pub const DEFAULT_EMBEDDING_DIMENSION: usize = 768;

/// Maximum embedding dimension supported by the vec_chunks virtual table.
/// Shorter vectors are zero-padded to this length.
pub(crate) const MAX_EMBEDDING_DIMENSION: usize = 4096;

pub(super) const SCHEMA_SQL: &str = r#"
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

pub(super) const PRAGMAS_SQL: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
"#;

/// Type-safe wrapper for the sqlite3_auto_extension callback.
///
/// `sqlite3_auto_extension` expects an `extern "C"` callback matching the
/// `sqlite3_auto_extension` prototype, but `sqlite_vec::sqlite3_vec_init`
/// takes no arguments and returns `()`. This wrapper bridges the two,
/// returning 0 (SQLITE_OK) to indicate success.
extern "C" fn sqlite3_vec_init_wrapper(
    _db: *mut ffi::sqlite3,
    _pz_err_msg: *mut *mut std::os::raw::c_char,
    _p_api: *const ffi::sqlite3_api_routines,
) -> std::os::raw::c_int {
    // SAFETY: `sqlite3_vec_init` is the C entry point of the sqlite-vec
    // loadable extension. It takes no arguments, writes no global state
    // outside the sqlite-vec module, and performs idempotent one-time
    // registration of its SQL functions. The wrapper's `_db`,
    // `_pz_err_msg`, and `_p_api` parameters are unused by sqlite-vec's
    // init signature (validated by the upstream crate's API), so passing
    // them through to the FFI call is sound. Called exactly once per
    // process boot via the SQLite auto-extension dispatch path.
    unsafe { sqlite_vec::sqlite3_vec_init() };
    0
}

/// Loads the sqlite-vec extension into the SQLite runtime.
pub(super) fn load_vec_extension() -> Result<(), String> {
    // SAFETY: `sqlite3_auto_extension` expects an `extern "C"` callback
    // matching its prototype (`*mut sqlite3`, `*mut *mut c_char`,
    // `*const sqlite3_api_routines` -> `c_int`). `sqlite3_vec_init_wrapper`
    // is declared with exactly that signature, so the `Some(...)` cast to
    // the function-pointer argument is sound. Registration is idempotent
    // and global, and is performed once per process boot before any RAG
    // connection is opened — vec is loaded into every subsequently-opened
    // SQLite connection without further `unsafe`.
    unsafe {
        ffi::sqlite3_auto_extension(Some(sqlite3_vec_init_wrapper));
    }
    Ok(())
}

/// Open (or create) the RAG SQLite database at the given path.
/// The parent directory must already exist.
pub(super) fn open_connection(db_path: &Path) -> Result<Connection, String> {
    // Load sqlite-vec extension globally BEFORE opening the connection
    load_vec_extension()?;

    let conn =
        Connection::open(db_path).map_err(|e| format!("Failed to open RAG database: {}", e))?;

    // Apply pragmas
    conn.execute_batch(PRAGMAS_SQL)
        .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    // Create schema
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to create RAG schema: {}", e))?;

    // Run migrations
    run_migrations(&conn)?;

    Ok(conn)
}

/// Open an additional read-side `Connection` against the same WAL-mode
/// database file. The schema, vec extension (loaded globally by
/// [`open_connection`]'s `sqlite3_auto_extension` call), and migrations are
/// already applied; this connection only needs the same pragmas.
///
/// Used to populate the read pool in [`super::RagStore::open`] so concurrent
/// readers can run in parallel.
pub(super) fn open_read_connection(db_path: &Path) -> Result<Connection, String> {
    let conn =
        Connection::open(db_path).map_err(|e| format!("Failed to open RAG database: {}", e))?;
    conn.execute_batch(PRAGMAS_SQL)
        .map_err(|e| format!("Failed to set pragmas for read pool: {}", e))?;
    Ok(conn)
}

/// Run database migrations for schema changes across versions.
pub(super) fn run_migrations(conn: &Connection) -> Result<(), String> {
    // Migration 1: Add `status` column to projects table.
    let has_status_column: bool = conn.prepare("SELECT status FROM projects LIMIT 0").is_ok();
    if !has_status_column {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'",
            [],
        )
        .map_err(|e| format!("Migration: failed to add status column: {}", e))?;
        tracing::info!("Migration: added status column to projects table");
    }

    // Migration 2: Recreate vec_chunks with cosine distance metric.
    let needs_vec_rebuild: bool = {
        let vec_exists: bool = conn
            .prepare("SELECT chunk_id, embedding FROM vec_chunks LIMIT 1")
            .is_ok();
        if !vec_exists {
            false
        } else {
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
        tracing::warn!("Migration: rebuilding vec_chunks with cosine distance metric. Existing embeddings will be lost.");
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

        conn.execute(
            "UPDATE projects SET chunk_count = 0, indexed_at = NULL WHERE 1",
            [],
        )
        .map_err(|e| format!("Migration: failed to reset project stats: {}", e))?;

        tracing::info!("Migration: vec_chunks rebuilt with cosine metric");
    }

    // Ensure the migration tracking table exists for future migrations
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _rag_migrations (name TEXT PRIMARY KEY, value TEXT);
         INSERT OR IGNORE INTO _rag_migrations (name, value) VALUES ('vec_cosine_metric', '1');",
    )
    .map_err(|e| format!("Migration: failed to ensure migration tracking: {}", e))?;

    Ok(())
}
