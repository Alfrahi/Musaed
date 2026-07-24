//! Integration tests for the RAG store (hybrid search, CRUD, deadlock regression).
//!
//! These tests exercise the `RagStore` public API through the `musaed_lib` crate,
//! following Cargo's integration test convention (`tests/` directory).

use musaed_lib::rag::store::connection::DEFAULT_EMBEDDING_DIMENSION;
use musaed_lib::rag::store::RagStore;
use musaed_lib::rag::types::{ChunkRow, FileRecord, ProjectStatus, RagProject};
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

#[tokio::test]
async fn test_create_and_get_project() {
    let store = test_store();
    let project = make_test_project("proj-1", "My Project", "/tmp/proj");
    store.create_project(&project).await.unwrap();

    let fetched = store.get_project("proj-1").await.unwrap();
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.id, "proj-1");
    assert_eq!(fetched.name, "My Project");
    assert_eq!(fetched.embedding_model, "nomic-embed-text-v2-moe");
    assert_eq!(fetched.ignore_patterns, vec!["node_modules"]);
}

#[tokio::test]
async fn test_list_projects() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();
    store
        .create_project(&make_test_project("p2", "B", "/b"))
        .await
        .unwrap();

    let projects = store.list_projects().await.unwrap();
    assert_eq!(projects.len(), 2);
}

#[tokio::test]
async fn test_delete_project() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();
    store.delete_project("p1").await.unwrap();
    assert!(store.get_project("p1").await.unwrap().is_none());
}

#[tokio::test]
async fn test_update_project_metadata() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();
    store
        .update_project_metadata("p1", Some("Updated"), Some(&["dist".to_string()]))
        .await
        .unwrap();

    let project = store.get_project("p1").await.unwrap().unwrap();
    assert_eq!(project.name, "Updated");
    assert_eq!(project.ignore_patterns, vec!["dist"]);
}

#[tokio::test]
async fn test_update_project_stats() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();
    store
        .update_project_stats("p1", 100, 500, 1024000, Some("2024-06-01T00:00:00Z"))
        .await
        .unwrap();

    let project = store.get_project("p1").await.unwrap().unwrap();
    assert_eq!(project.file_count, 100);
    assert_eq!(project.chunk_count, 500);
}

#[tokio::test]
async fn test_upsert_file() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "p1".to_string(),
        relative_path: "src/main.rs".to_string(),
        file_hash: "abc123".to_string(),
        file_size: 1024,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 3,
    };

    let file_id = store.upsert_file(&file).await.unwrap();
    assert!(file_id > 0);

    // Upsert same file (update)
    let updated = FileRecord {
        id: None,
        file_hash: "def456".to_string(),
        file_size: 2048,
        ..file.clone()
    };
    let same_id = store.upsert_file(&updated).await.unwrap();
    assert_eq!(file_id, same_id);

    let fetched = store
        .get_file_by_path("p1", "src/main.rs")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched.file_hash, "def456");
    assert_eq!(fetched.file_size, 2048);
}

#[tokio::test]
async fn test_insert_and_search_chunks() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "p1".to_string(),
        relative_path: "src/main.rs".to_string(),
        file_hash: "abc".to_string(),
        file_size: 100,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 1,
    };
    let file_id = store.upsert_file(&file).await.unwrap();

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

    let chunk_id = store.insert_chunk(&chunk).await.unwrap();
    assert!(chunk_id > 0);

    // Insert a dummy embedding (768-dim, non-zero for testing)
    let mut embedding = vec![0.0f32; 768];
    embedding[0] = 1.0;
    store.insert_embedding(chunk_id, &embedding).await.unwrap();

    // Search with the same vector query
    let mut query = vec![0.0f32; 768];
    query[0] = 1.0;
    let results = store.search_similar("p1", &query, 10, 0.0).await.unwrap();
    // With identical vectors, distance should be 0 (perfect match)
    assert!(!results.is_empty());
    assert_eq!(results[0].file_path, "src/main.rs");
}

#[tokio::test]
async fn test_delete_file_cascades() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "p1".to_string(),
        relative_path: "src/lib.rs".to_string(),
        file_hash: "abc".to_string(),
        file_size: 100,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 1,
    };
    let file_id = store.upsert_file(&file).await.unwrap();

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

    let chunk_id = store.insert_chunk(&chunk).await.unwrap();
    let embedding = vec![0.0f32; 768];
    store.insert_embedding(chunk_id, &embedding).await.unwrap();

    store.delete_file(file_id).await.unwrap();

    let chunks = store.get_file_chunks(file_id).await.unwrap();
    assert!(chunks.is_empty());
}

#[tokio::test]
async fn test_get_project_stats() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let stats = store.get_project_stats("p1").await.unwrap();
    assert_eq!(stats.file_count, 0);
    assert_eq!(stats.chunk_count, 0);
}

#[tokio::test]
async fn test_embedding_dimension() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let dim = store.get_embedding_dimension("p1").await.unwrap();
    assert_eq!(dim, DEFAULT_EMBEDDING_DIMENSION);

    store.set_embedding_dimension("p1", 1024).await.unwrap();
    let dim = store.get_embedding_dimension("p1").await.unwrap();
    assert_eq!(dim, 1024);
}

/// Regression test for BUG-001: delete_file must not deadlock when
/// deleting embeddings, chunks, and the file row under a single Mutex
/// lock acquisition. std::sync::Mutex is non-recursive on Linux.
#[tokio::test]
async fn test_delete_file_no_deadlock() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "p1".to_string(),
        relative_path: "src/deadlock_test.rs".to_string(),
        file_hash: "deadbeef".to_string(),
        file_size: 200,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 2,
    };
    let file_id = store.upsert_file(&file).await.unwrap();

    // Insert chunks and embeddings
    for i in 0..2 {
        let chunk = ChunkRow {
            id: None,
            project_id: "p1".to_string(),
            file_id,
            chunk_index: i,
            content: format!("// chunk {i}"),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: i * 10 + 1,
            end_line: i * 10 + 10,
            metadata: serde_json::json!({}),
        };
        let chunk_id = store.insert_chunk(&chunk).await.unwrap();
        let embedding = vec![0.0f32; 768];
        store.insert_embedding(chunk_id, &embedding).await.unwrap();
    }

    // This call would previously deadlock (BUG-001).
    store
        .delete_file(file_id)
        .await
        .expect("delete_file should succeed");

    // Verify all data is gone
    assert!(store.get_file_chunks(file_id).await.unwrap().is_empty());
    assert!(store
        .get_file_by_path("p1", "src/deadlock_test.rs")
        .await
        .unwrap()
        .is_none());
}

/// Regression test for BUG-001: delete_file_chunks must not deadlock
/// when deleting embeddings and chunks under a single Mutex lock.
#[tokio::test]
async fn test_delete_file_chunks_no_deadlock() {
    let store = test_store();
    store
        .create_project(&make_test_project("p1", "A", "/a"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "p1".to_string(),
        relative_path: "src/chunks_deadlock.rs".to_string(),
        file_hash: "cafe".to_string(),
        file_size: 100,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 1,
    };
    let file_id = store.upsert_file(&file).await.unwrap();

    let chunk = ChunkRow {
        id: None,
        project_id: "p1".to_string(),
        file_id,
        chunk_index: 0,
        content: "fn test() {}".to_string(),
        chunk_type: "code".to_string(),
        language: Some("rust".to_string()),
        start_line: 1,
        end_line: 1,
        metadata: serde_json::json!({}),
    };
    let chunk_id = store.insert_chunk(&chunk).await.unwrap();
    let embedding = vec![0.0f32; 768];
    store.insert_embedding(chunk_id, &embedding).await.unwrap();

    // This call would previously deadlock (BUG-001).
    store
        .delete_file_chunks(file_id)
        .await
        .expect("delete_file_chunks should succeed");

    assert!(store.get_file_chunks(file_id).await.unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Maj-3 regression tests (AUDIT-REPORT.md): RAG store read parallelism.
//
// The store used to be a global `tokio::sync::Mutex<RagStore>` serializing
// every RAG op against every other op. The fix wraps it in a read/write lock
// at the services layer and adds a connection pool inside `RagStore` so
// distinct concurrent readers draw distinct slots and run in parallel.
//
// These tests prove (1) concurrent readers do not deadlock when mixed with a
// writer, and (2) concurrent reads complete materially faster than the
// serial equivalent — the empirical evidence that the pool is in use.
// ---------------------------------------------------------------------------

/// Regression test for Maj-3: many concurrent readers + a writer must not
/// deadlock. With a single-mutex store this WOULD have deadlocked when the
/// writer's guard held the only slot while readers were already queued.
#[tokio::test]
async fn test_maj3_concurrent_reads_and_writer_no_deadlock() {
    let store = std::sync::Arc::new(test_store());
    store
        .create_project(&make_test_project("maj3-dl", "P", "/tmp/maj3-dl"))
        .await
        .unwrap();

    // Spawn 12 readers that each list projects a handful of times.
    let mut reader_handles = Vec::new();
    for _ in 0..12 {
        let s = store.clone();
        reader_handles.push(tokio::spawn(async move {
            for _ in 0..20 {
                let _ = s.list_projects().await.unwrap();
            }
        }));
    }

    // Concurrently run a few writers through the outer write guard
    // (simulating indexing status transitions).
    let mut writer_handles = Vec::new();
    for i in 0..4 {
        let s = store.clone();
        writer_handles.push(tokio::spawn(async move {
            for _ in 0..10 {
                let status = if i % 2 == 0 {
                    ProjectStatus::Indexing
                } else {
                    ProjectStatus::Ready
                };
                // Use the internal store setter (a write path) to mimic
                // how the indexing pipeline marks status transitions.
                let conn = s.write_conn().await;
                let now = chrono::Utc::now().to_rfc3339();
                let _ = conn.execute(
                    "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![status.as_str(), now, "maj3-dl"],
                );
                drop(conn);
            }
        }));
    }

    for h in reader_handles {
        h.await.expect("reader task panicked");
    }
    for h in writer_handles {
        h.await.expect("writer task panicked");
    }

    // Sanity: the project still exists after the storm.
    assert!(store.get_project("maj3-dl").await.unwrap().is_some());
}

/// Regression test for Maj-3: reads actually run in parallel. Acquire the
/// read guard in 8 concurrent tasks and hold each for a fixed sleep; with a
/// 4-slot pool the total wall time is roughly 2 rounds (~2× the sleep), vs 8
/// rounds for a single-mutex store. The bound is generous to avoid flakes on
/// CI but tight enough to detect a regression to a single slot.
///
/// Requires the multi-threaded tokio runtime — the default current-thread
/// runtime serializes tasks regardless of the pool size and would mask a
/// regression to a single slot.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_maj3_concurrent_reads_run_in_parallel() {
    let store = std::sync::Arc::new(test_store());

    const READERS: usize = 8;
    const HOLD: std::time::Duration = std::time::Duration::from_millis(40);

    let start = tokio::time::Instant::now();
    let mut handles = Vec::new();
    for _ in 0..READERS {
        let s = store.clone();
        handles.push(tokio::spawn(async move {
            let _guard = s.read_conn().await;
            tokio::time::sleep(HOLD).await;
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
    let elapsed = start.elapsed();

    // Lower bound is ~READERS * HOLD (8 * 40 = 320ms) for a single-slot store.
    // With a 4-slot pool on a 4-thread runtime it should be ~2 rounds = ~80ms
    // + scheduling overhead. Bound at half the single-slot time to detect a
    // regression to a single shared connection while staying above scheduling
    // noise on a slow CI host.
    let single_slot_baseline = HOLD * READERS as u32;
    let parallel_cap = single_slot_baseline / 2;
    assert!(
        elapsed < parallel_cap,
        "concurrent reads took {:?}, expected parallel completion well under {:?} — \
         read pool may have regressed to a single slot",
        elapsed,
        parallel_cap,
    );
}
