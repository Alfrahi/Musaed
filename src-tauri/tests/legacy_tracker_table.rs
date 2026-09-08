//! Regression: a RAG database carrying the legacy probe-era `_rag_migrations`
//! table — schema `(name TEXT PRIMARY KEY, value TEXT)` from before the
//! versioned-transaction refactor (e3bdc9af) — must migrate cleanly. The
//! version tracker's `SELECT MAX(version)` keyed every framework operation on
//! that table; on the legacy shape it failed, so `open_connection` returned
//! `Err` and `RagStore::open` silently degraded to `rag_enabled = false`
//! ("sqlite-vec extension not loaded"), leaving bm25 tables at the v4 shape.

use musaed_lib::migrations::{self, MigrationTarget};
use musaed_lib::rag::store::RagStore;
use rusqlite::Connection;
use std::path::Path;

/// Load the sqlite-vec extension into the process so the fixture can create
/// the `vec0` virtual table. Mirrors `connection::load_vec_extension`, which
/// is `pub(super)` and not reachable from an integration test.
fn load_vec_extension() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(sqlite3_vec_init_wrapper));
    }
}

extern "C" fn sqlite3_vec_init_wrapper(
    _db: *mut rusqlite::ffi::sqlite3,
    _pz_err_msg: *mut *mut std::os::raw::c_char,
    _p_api: *const rusqlite::ffi::sqlite3_api_routines,
) -> std::os::raw::c_int {
    unsafe { sqlite_vec::sqlite3_vec_init() };
    0
}

/// Hand-build the pre-framework legacy DB: probe-era tracker table,
/// `user_version = 3`, no bm25 tables — the state the old (pre-576998e)
/// `run_migrations` left behind.
fn build_legacy_db(path: &Path) {
    load_vec_extension();
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
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
         CREATE VIRTUAL TABLE vec_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding float[1024] distance_metric=cosine);
         CREATE VIRTUAL TABLE chunks_fts USING fts5(content,
            content='chunks', content_rowid='rowid');
         CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
            INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
         END;
         CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, content)
            VALUES ('delete', old.rowid, old.content);
         END;
         CREATE TRIGGER chunks_fts_au AFTER UPDATE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, content)
            VALUES ('delete', old.rowid, old.content);
            INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
         END;
         CREATE TABLE _rag_migrations (name TEXT PRIMARY KEY, value TEXT);
         INSERT INTO _rag_migrations (name, value) VALUES ('vec_cosine_metric', '1');
         PRAGMA user_version = 3;",
    )
    .unwrap();
}

fn columns(conn: &Connection, table: &str) -> Vec<String> {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn legacy_probe_era_tracker_table_is_replaced_and_migrated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rag.db");
    build_legacy_db(&path);

    let mut conn = Connection::open(&path).unwrap();
    migrations::migrate_rag_db(&mut conn).expect("legacy tracker table must not fail");

    // Tracker replaced with the canonical framework schema.
    let tracker_cols = columns(&conn, "_rag_migrations");
    assert_eq!(
        tracker_cols,
        vec![
            "version",
            "description",
            "applied_at",
            "execution_time_ms",
            "checksum"
        ],
        "tracker cols: {tracker_cols:?}"
    );

    let version = migrations::get_current_version(&conn, MigrationTarget::Rag).unwrap();
    assert_eq!(version, 5, "tracker should reach latest");

    let user_version: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, 5);

    // bm25 tables at the v5 per-project shape.
    for table in ["bm25_doc_freq", "bm25_doc_len"] {
        let cols = columns(&conn, table);
        assert!(
            cols.contains(&"project_id".to_string()),
            "{table} missing project_id: {cols:?}"
        );
    }

    // vec_chunks exists with the cosine metric; FTS index + triggers present.
    let fts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'chunks_fts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(fts, 1);
    let triggers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'chunks_fts_%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(triggers, 3);
}

/// End-to-end through the public store: the degraded-fallback regression was
/// `RagStore::open` succeeding with `rag_enabled = false`.
#[tokio::test]
async fn store_opens_fully_enabled_on_legacy_tracker_db() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rag.db");
    build_legacy_db(&path);

    let store = RagStore::open(&path).expect("store must open");
    assert!(
        store.is_rag_enabled(),
        "legacy probe-era tracker must not silently disable RAG features"
    );

    let conn = store.read_conn().await;
    let cols = columns(&conn, "bm25_doc_len");
    assert!(
        cols.contains(&"project_id".to_string()),
        "bm25_doc_len must be at the v5 shape: {cols:?}"
    );
}
