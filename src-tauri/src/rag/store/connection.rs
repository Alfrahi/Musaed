//! Database connection management, schema, and migrations.

use crate::rag::error::{RagError, RagResult};
use rusqlite::{ffi, Connection, Transaction};
use std::path::Path;

/// Highest schema version this build understands. Bump when adding a
/// migration and append a matching `migrate_v*_to_v*` function.
const LATEST_SCHEMA_VERSION: u32 = 2;

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
pub(super) fn load_vec_extension() -> RagResult<()> {
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
pub(super) fn open_connection(db_path: &Path) -> RagResult<Connection> {
    // Load sqlite-vec extension globally BEFORE opening the connection
    load_vec_extension()?;

    let mut conn = Connection::open(db_path)?;

    // Apply pragmas
    conn.execute_batch(PRAGMAS_SQL)?;

    // Verify WAL actually activated. On filesystems without shared-memory /
    // locking support (NFS, SMB, some network mounts), SQLite silently falls
    // back to DELETE mode, breaking the concurrent readers this store relies
    // on. Fail loudly instead of degrading.
    let journal_mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        tracing::error!(
            path = %db_path.display(),
            journal_mode = %journal_mode,
            "WAL journal mode not activated for RAG database"
        );
        return Err(RagError::Config(format!(
            "WAL journal mode is required but the database reports '{journal_mode}' after setup. \
             WAL is not supported on this filesystem for '{}'. Move the database to a local SSD, \
             check file permissions, and verify the filesystem supports WAL (not NFS/SMB).",
            db_path.display(),
        )));
    }

    // Create schema
    conn.execute_batch(SCHEMA_SQL)?;

    // Run migrations
    run_migrations(&mut conn)?;

    Ok(conn)
}

/// Open an additional read-side `Connection` against the same WAL-mode
/// database file. The schema, vec extension (loaded globally by
/// [`open_connection`]'s `sqlite3_auto_extension` call), and migrations are
/// already applied; this connection only needs the same pragmas.
///
/// Used to populate the read pool in [`super::RagStore::open`] so concurrent
/// readers can run in parallel.
pub(super) fn open_read_connection(db_path: &Path) -> RagResult<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(PRAGMAS_SQL)?;
    Ok(conn)
}

/// Run database migrations, advancing `PRAGMA user_version` from its current
/// value to [`LATEST_SCHEMA_VERSION`]. Each step runs inside its own
/// transaction; if a step fails the transaction auto-rolls back and the
/// database remains at the last successfully-applied version.
pub(super) fn run_migrations(conn: &mut Connection) -> RagResult<()> {
    let mut current: u32 = conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;

    if current > LATEST_SCHEMA_VERSION {
        tracing::warn!(
            current_version = current,
            latest_version = LATEST_SCHEMA_VERSION,
            "Database user_version is newer than this build understands; skipping migrations"
        );
        return Ok(());
    }

    while current < LATEST_SCHEMA_VERSION {
        let tx = conn.transaction()?;
        match current {
            0 => migrate_v0_to_v1(&tx)?,
            1 => migrate_v1_to_v2(&tx)?,
            v => {
                return Err(RagError::Config(format!(
                    "No migration path from schema version {v} (latest is {LATEST_SCHEMA_VERSION})"
                )));
            }
        }
        // Bump user_version inside the same transaction so a crash between
        // commit and the PRAGMA never leaves a gap.
        tx.execute_batch(&format!("PRAGMA user_version = {}", current + 1))?;
        tx.commit()?;
        tracing::info!("Migration: schema version {} -> {}", current, current + 1);
        current += 1;
    }

    Ok(())
}

/// Migration v0 → v1: add the `status` column to the `projects` table.
///
/// On a fresh database the schema SQL already includes the column, so
/// `ALTER TABLE … ADD COLUMN` will error with "duplicate column name". We
/// guard against that by checking `PRAGMA table_info` first.
fn migrate_v0_to_v1(tx: &Transaction) -> RagResult<()> {
    let has_status: bool = tx.prepare("SELECT status FROM projects LIMIT 0").is_ok();
    if !has_status {
        tx.execute(
            "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'",
            [],
        )?;
        tracing::info!("Migration v0→v1: added status column to projects");
    }
    Ok(())
}

/// Migration v1 → v2: rebuild `vec_chunks` with the cosine distance metric.
///
/// The original `vec0` table shipped with the default (Euclidean) distance
/// metric. Rebuilding with `distance_metric=cosine` drops existing
/// embeddings and resets `chunk_count`/`indexed_at` so the index can be
/// rebuilt on the next indexing pass.
fn migrate_v1_to_v2(tx: &Transaction) -> RagResult<()> {
    tracing::warn!(
        "Migration v1→v2: rebuilding vec_chunks with cosine distance metric; existing embeddings will be lost"
    );

    tx.execute_batch(
        "DROP TABLE IF EXISTS vec_chunks;
         CREATE VIRTUAL TABLE vec_chunks USING vec0(
             chunk_id  INTEGER PRIMARY KEY,
             embedding float[4096] distance_metric=cosine
         );",
    )?;

    tx.execute(
        "UPDATE projects SET chunk_count = 0, indexed_at = NULL WHERE 1",
        [],
    )?;

    tracing::info!("Migration v1→v2: vec_chunks rebuilt with cosine metric");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wal_mode_activates_on_local_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");
        let conn = open_connection(&db_path).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_ascii_lowercase(), "wal");
    }

    #[test]
    fn fresh_db_reaches_latest_schema_version() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");
        let conn = open_connection(&db_path).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            version, LATEST_SCHEMA_VERSION,
            "fresh database should be at latest schema version after migrations"
        );
    }

    #[test]
    fn migrations_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");
        let mut conn = open_connection(&db_path).unwrap();
        // Running migrations on an already-migrated database should not error.
        run_migrations(&mut conn).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn migration_v0_to_v1_adds_status_column() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");

        // Manually create a v0 schema (no status column) and set user_version=0
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(PRAGMAS_SQL).unwrap();
            conn.execute_batch(
                r#"
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
                    embedding_dimension INTEGER NOT NULL DEFAULT 0
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                    chunk_id  INTEGER PRIMARY KEY,
                    embedding float[4096]
                );
                "#,
            )
            .unwrap();
            // user_version defaults to 0 on a fresh DB
        }

        // Run migrations — should reach version 2
        let conn = open_connection(&db_path).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_SCHEMA_VERSION);

        // status column should now exist
        assert!(conn.prepare("SELECT status FROM projects LIMIT 0").is_ok());
        // vec_chunks should have cosine metric (rebuild)
        // We verify indirectly by checking the table exists and is queryable
        assert!(conn
            .prepare("SELECT chunk_id, embedding FROM vec_chunks LIMIT 0")
            .is_ok());
    }
}
