//! Database connection management, schema, and migrations.

use crate::rag::error::{RagError, RagResult};
use rusqlite::{ffi, Connection};
use std::path::Path;

/// Default embedding vector dimension. Will be overridden per-project after
/// the first embedding call detects the actual dimension.
pub const DEFAULT_EMBEDDING_DIMENSION: usize = 768;

/// Dimension of the `vec_chunks` vector column. Shorter vectors are
/// zero-padded, longer are truncated. 1024 covers the embedding models
/// Musaed ships with (768-dim) without the ~4× storage bloat the old 4096
/// cap imposed on every row (RAG P1).
pub(crate) const MAX_EMBEDDING_DIMENSION: usize = 1024;

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
    embedding float[1024] distance_metric=cosine
);

-- Corpus-wide full-text index over chunk content, kept in sync by triggers.
-- Powers the lexical leg of hybrid search so pure keyword matches can be
-- rescued even when the embedding model ranks them poorly (RAG R1).
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    content='chunks',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_chunks_project_id ON chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);

-- Corpus-wide BM25 statistics for hybrid search, scoped per project.
-- `bm25_doc_freq` stores the number of documents containing each term;
-- `bm25_doc_len` stores per-chunk token length so average document length is
-- computable. Maintained transactionally on chunk insert/delete and lazily
-- rebuilt when empty (the v4/v5 backfill path). Without these, hybrid scoring
-- would be computed against the per-query candidate window, making IDF
-- non-comparable across queries. The `project_id` column keeps IDF and
-- average length correct when multiple projects coexist.
CREATE TABLE IF NOT EXISTS bm25_doc_freq (
    project_id TEXT NOT NULL,
    term       TEXT NOT NULL,
    doc_count  INTEGER NOT NULL,
    PRIMARY KEY (project_id, term)
);

CREATE TABLE IF NOT EXISTS bm25_doc_len (
    project_id TEXT NOT NULL,
    chunk_id   INTEGER NOT NULL,
    len        INTEGER NOT NULL,
    PRIMARY KEY (project_id, chunk_id)
);
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

    // Unify versioning through the migrations framework (`_rag_migrations`
    // table + per-step apply loop). `migrate_rag_db` bridges legacy
    // `PRAGMA user_version` databases by stamping the tracker from the
    // pragma before running any pending steps.
    crate::migrations::migrate_rag_db(&mut conn)
        .map_err(|e| RagError::Config(format!("RAG migrations failed: {e}")))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::rag as rag_migrations;

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
            version,
            rag_migrations::LATEST_VERSION,
            "fresh database should be at latest schema version after migrations"
        );
    }

    #[test]
    fn migrations_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");
        let mut conn = open_connection(&db_path).unwrap();
        // Running migrations on an already-migrated database should not error.
        crate::migrations::migrate_rag_db(&mut conn).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, rag_migrations::LATEST_VERSION);
    }

    #[test]
    fn migration_v0_to_v1_adds_status_column() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");

        // Manually create a v0 schema (no status column) and set user_version=0
        {
            load_vec_extension().unwrap();
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
                    embedding float[4096]
                );
                "#,
            )
            .unwrap();
            // user_version defaults to 0 on a fresh DB
        }

        // Run migrations — should reach the latest version
        let conn = open_connection(&db_path).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, rag_migrations::LATEST_VERSION);

        // status column should now exist
        assert!(conn.prepare("SELECT status FROM projects LIMIT 0").is_ok());
        // vec_chunks should have cosine metric (rebuilt at v2, shrunk at v3)
        assert!(conn
            .prepare("SELECT chunk_id, embedding FROM vec_chunks LIMIT 0")
            .is_ok());
        // chunks_fts should exist and be backfilled from chunk content
        assert!(conn
            .prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH '\"x\"' LIMIT 0")
            .is_ok());
    }

    /// Old v2 database with a populated chunk must upgrade to v3: embeddings
    /// are dropped (dimension shrink), project stats reset, and the new FTS
    /// index is backfilled with the *existing* chunk text so lexical search
    /// works before reindexing (RAG P1/R1 migration-proofness).
    #[test]
    fn migration_v2_to_v3_preserves_chunks_backfills_fts_drops_embeddings() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("rag.db");

        // Hand-build a v2 database with one project/file/chunk and one
        // 4096-dim embedding, as a pre-upgrade database would have.
        {
            load_vec_extension().unwrap();
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(PRAGMAS_SQL).unwrap();
            conn.execute_batch(SCHEMA_SQL).unwrap();
            // Force the old 4096-dim table (SCHEMA_SQL now creates 1024).
            conn.execute_batch(
                "DROP TABLE vec_chunks;
                 CREATE VIRTUAL TABLE vec_chunks USING vec0(
                     chunk_id  INTEGER PRIMARY KEY,
                     embedding float[4096] distance_metric=cosine
                 );",
            )
            .unwrap();
            conn.execute_batch("PRAGMA user_version = 2").unwrap();

            conn.execute(
                "INSERT INTO projects (id, name, path, embedding_model, created_at, updated_at, chunk_count)
                 VALUES ('p', 'P', '/x', 'm', 't', 't', 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO files (project_id, relative_path, file_hash, file_size, modified_at)
                 VALUES ('p', 'a.rs', 'h', 1, 't')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO chunks (project_id, file_id, chunk_index, content)
                 VALUES ('p', 1, 0, 'fn tokenize_query() {}')",
                [],
            )
            .unwrap();
            let chunk_id = conn.last_insert_rowid();
            let embedding = vec![0.5f32; 4096];
            let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
            conn.execute(
                "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)",
                rusqlite::params![chunk_id, bytes],
            )
            .unwrap();
        }

        let conn = open_connection(&db_path).unwrap();
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, rag_migrations::LATEST_VERSION);

        // Chunk rows survived the upgrade.
        let chunk_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(chunk_count, 1);

        // Embeddings were dropped with the 4096-dim table.
        let vec_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM vec_chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(vec_count, 0);

        // Project stats were reset so a reindex is forced.
        let (chunk_stat, indexed_at): (i64, Option<String>) = conn
            .query_row(
                "SELECT chunk_count, indexed_at FROM projects WHERE id = 'p'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(chunk_stat, 0);
        assert!(indexed_at.is_none());

        // FTS backfilled from existing chunk text: lexical match works.
        let fts_hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH '\"tokenize\"'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_hits, 1);
    }
    /// Fresh-vs-upgraded schema parity for the RAG database: comparing
    /// PRAGMA table_info between a fresh SCHEMA_SQL database and a legacy v0
    /// database migrated up catches schema/migration drift (Rust #13).
    #[test]
    fn fresh_vs_upgraded_schema_parity() {
        let table_info = |conn: &Connection, table: &str| -> Vec<String> {
            conn.prepare(&format!("PRAGMA table_info({})", table))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };

        // Fresh: open_connection runs full SCHEMA_SQL + migrate_rag_db.
        let dir = tempfile::tempdir().unwrap();
        let fresh = open_connection(&dir.path().join("rag.db")).unwrap();

        // Upgraded: hand-build the legacy v2 schema (no status col, no fts,
        // 4096-dim vec_chunks would be intermediate) then run the full path.
        let dir2 = tempfile::tempdir().unwrap();
        let upgraded_path = dir2.path().join("rag.db");
        {
            let c = Connection::open(&upgraded_path).unwrap();
            c.execute_batch(PRAGMAS_SQL).unwrap();
            c.execute_batch(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE, embedding_model TEXT NOT NULL,
                    ignore_patterns TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    indexed_at TEXT, file_count INTEGER NOT NULL DEFAULT 0,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    total_bytes INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'idle',
                    embedding_dimension INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT NOT NULL, relative_path TEXT NOT NULL,
                    file_hash TEXT NOT NULL, file_size INTEGER NOT NULL,
                    modified_at TEXT NOT NULL,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(project_id, relative_path));
                 CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT NOT NULL, file_id INTEGER NOT NULL,
                    chunk_index INTEGER NOT NULL, content TEXT NOT NULL,
                    chunk_type TEXT NOT NULL DEFAULT 'text', language TEXT,
                    start_line INTEGER, end_line INTEGER,
                    metadata TEXT DEFAULT '{}', UNIQUE(file_id, chunk_index));
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        }
        let upgraded = open_connection(&upgraded_path).unwrap();

        for table in ["projects", "files", "chunks"] {
            assert_eq!(
                table_info(&fresh, table),
                table_info(&upgraded, table),
                "table_info mismatch for {}",
                table
            );
        }
        // Both must expose the full-text index table.
        let fts_fresh: i64 = fresh
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='chunks_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let fts_upgraded: i64 = upgraded
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='chunks_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_fresh, 1);
        assert_eq!(fts_upgraded, 1);

        // Both must expose the per-project BM25 statistics tables with
        // identical schema (v5 scopes them by project_id).
        for table in ["bm25_doc_freq", "bm25_doc_len"] {
            assert_eq!(
                table_info(&fresh, table),
                table_info(&upgraded, table),
                "table_info mismatch for {}",
                table
            );
            let fresh_cols: Vec<String> = table_info(&fresh, table);
            assert!(
                fresh_cols.contains(&"project_id".to_string()),
                "{} missing project_id column",
                table
            );
        }
    }
}
