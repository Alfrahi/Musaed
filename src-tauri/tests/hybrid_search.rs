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
    RagStore::open(&db_path).expect("Failed to open test store")
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

/// Regression test: Results MUST be deterministic. The hybrid ranking
/// pipeline (BM25 + vector) is fed by `search_similar`; if its ordering or
/// float scoring ever became non-deterministic — e.g. from a SQLite plan
/// change, a float-ordering refactor in BM25, or a future swap to a
/// non-stable sort — silent regressions would surface as query results
/// that drift between runs.
///
/// This test asserts that the same query issued twice against the same
/// store returns byte-identical serialised ranked output (chunk ids,
/// scores, ordering). It exercises multiple candidates with distinct
/// embeddings so the ranking order is non-trivial.
#[tokio::test]
async fn test_search_results_are_deterministic() {
    let store = test_store();
    store
        .create_project(&make_test_project("det", "Determinism", "/tmp/det"))
        .await
        .unwrap();

    // Three chunks with distinct embeddings so ranking order is meaningful.
    let embeddings_and_content: [([f32; 768], &str); 3] = [
        {
            let mut e = [0.0f32; 768];
            e[0] = 1.0;
            (e, "fn sort_by_score(items: &[f32]) -> Vec<f32>")
        },
        {
            let mut e = [0.0f32; 768];
            e[1] = 1.0;
            (e, "fn bm25_score(query: &str, doc: &str) -> f32")
        },
        {
            let mut e = [0.0f32; 768];
            e[2] = 1.0;
            (e, "struct HybridSearchEngine { weights: VectorWeights }")
        },
    ];

    for (i, (embedding, content)) in embeddings_and_content.iter().enumerate() {
        let file = FileRecord {
            id: None,
            project_id: "det".to_string(),
            relative_path: format!("src/file_{i}.rs"),
            file_hash: format!("hash_{i}"),
            file_size: 100,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 1,
        };
        let file_id = store.upsert_file(&file).await.unwrap();

        let chunk = ChunkRow {
            id: None,
            project_id: "det".to_string(),
            file_id,
            chunk_index: 0,
            content: content.to_string(),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: 1,
            end_line: 5,
            metadata: serde_json::json!({"topic": "rag"}),
        };
        let chunk_id = store.insert_chunk(&chunk).await.unwrap();
        store.insert_embedding(chunk_id, embedding).await.unwrap();
    }

    // A query embedding that overlaps all three basis vectors so every
    // candidate is returned but ranked in a specific order.
    let mut query = vec![0.0f32; 768];
    query[0] = 0.6;
    query[1] = 0.3;
    query[2] = 0.1;

    let first = serde_json::to_string(&store.search_similar("det", &query, 10, 0.0).await.unwrap())
        .expect("first results serialize");
    let second =
        serde_json::to_string(&store.search_similar("det", &query, 10, 0.0).await.unwrap())
            .expect("second results serialize");

    assert!(!first.is_empty(), "search returned no candidates");
    assert_eq!(
        first, second,
        "repeated identical queries produced different rankings or scores — \
         §8 determinism invariant violated"
    );
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

/// Regression test: delete_file must not deadlock when deleting
/// embeddings, chunks, and the file row under a single Mutex lock
/// acquisition. std::sync::Mutex is non-recursive on Linux.
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

/// Regression test: delete_file_chunks must not deadlock when deleting
/// embeddings and chunks under a single Mutex lock.
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
        .delete_file_chunks("p1", file_id)
        .await
        .expect("delete_file_chunks should succeed");

    assert!(store.get_file_chunks(file_id).await.unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Maj-3 regression tests: RAG store read parallelism.
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

// ---------------------------------------------------------------------------
// RAG P2: per-file batch store must be a single atomic transaction.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_insert_chunks_with_embeddings_batch() {
    let store = test_store();
    store
        .create_project(&make_test_project("batch", "Batch", "/tmp/batch"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "batch".to_string(),
        relative_path: "src/lib.rs".to_string(),
        file_hash: "hash".to_string(),
        file_size: 42,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 2,
    };
    let file_id = store.upsert_file(&file).await.unwrap();

    let chunks: Vec<ChunkRow> = (0..2)
        .map(|i| ChunkRow {
            id: None,
            project_id: "batch".to_string(),
            file_id,
            chunk_index: i,
            content: format!("fn part_{i}() {{}}"),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: 1,
            end_line: 2,
            metadata: serde_json::json!({}),
        })
        .collect();

    let mut e0 = vec![0.0f32; 768];
    e0[0] = 1.0;
    let mut e1 = vec![0.0f32; 768];
    e1[1] = 1.0;
    let embeddings = vec![e0, e1];

    store
        .insert_chunks_with_embeddings(&chunks, &embeddings)
        .await
        .unwrap();

    let stored = store.get_file_chunks(file_id).await.unwrap();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].content, "fn part_0() {}");
    assert_eq!(stored[1].content, "fn part_1() {}");

    // Embeddings landed: searching for the first embedding returns part_0.
    let mut query = vec![0.0f32; 768];
    query[0] = 1.0;
    let results = store
        .search_similar("batch", &query, 10, 0.0)
        .await
        .unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].content, "fn part_0() {}");
}

// ---------------------------------------------------------------------------
// RAG R7: delete_project must not orphan vec_chunks rows.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_delete_project_leaves_no_orphan_embeddings() {
    let store = test_store();
    for (pid, path) in [("victim", "/tmp/victim"), ("keeper", "/tmp/keeper")] {
        store
            .create_project(&make_test_project(pid, pid, path))
            .await
            .unwrap();
        let file = FileRecord {
            id: None,
            project_id: pid.to_string(),
            relative_path: "a.rs".to_string(),
            file_hash: "h".to_string(),
            file_size: 1,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 1,
        };
        let file_id = store.upsert_file(&file).await.unwrap();
        let chunk = ChunkRow {
            id: None,
            project_id: pid.to_string(),
            file_id,
            chunk_index: 0,
            content: format!("fn {pid}() {{}}"),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: 1,
            end_line: 1,
            metadata: serde_json::json!({}),
        };
        let chunk_id = store.insert_chunk(&chunk).await.unwrap();
        let mut embedding = vec![0.0f32; 768];
        embedding[0] = 1.0;
        store.insert_embedding(chunk_id, &embedding).await.unwrap();
    }

    store.delete_project("victim").await.unwrap();

    // Zero orphan vec rows may remain: every vec_chunks row must belong to
    // a chunk that still exists.
    let orphans: i64 = {
        let conn = store.read_conn().await;
        conn.query_row(
            "SELECT COUNT(*) FROM vec_chunks v WHERE NOT EXISTS \
             (SELECT 1 FROM chunks c WHERE c.id = v.chunk_id)",
            [],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert_eq!(orphans, 0, "delete_project left orphan vec_chunks rows");

    // The surviving project is intact.
    let keeper_stats = store.get_project_stats("keeper").await.unwrap();
    assert_eq!(keeper_stats.chunk_count, 1);
    let mut query = vec![0.0f32; 768];
    query[0] = 1.0;
    let results = store
        .search_similar("keeper", &query, 10, 0.0)
        .await
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].content, "fn keeper() {}");
}

// ---------------------------------------------------------------------------
// RAG R1: corpus-wide lexical search via chunks_fts.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_search_lexical_finds_keyword_matches_corpus_wide() {
    let store = test_store();
    store
        .create_project(&make_test_project("lex", "Lex", "/tmp/lex"))
        .await
        .unwrap();

    // Two files, three chunks; only one contains the rare term.
    let mut file_ids = Vec::new();
    for (path, chunks) in [
        ("a.rs", vec!["fn alpha() {}", "fn beta() {}"]),
        ("b.rs", vec!["fn handle_zephyr_shutdown() {}"]),
    ] {
        let file = FileRecord {
            id: None,
            project_id: "lex".to_string(),
            relative_path: path.to_string(),
            file_hash: "h".to_string(),
            file_size: 10,
            modified_at: "2024-01-01".to_string(),
            chunk_count: chunks.len(),
        };
        let file_id = store.upsert_file(&file).await.unwrap();
        file_ids.push(file_id);
        for (i, content) in chunks.iter().enumerate() {
            store
                .insert_chunk(&ChunkRow {
                    id: None,
                    project_id: "lex".to_string(),
                    file_id,
                    chunk_index: i,
                    content: content.to_string(),
                    chunk_type: "code".to_string(),
                    language: Some("rust".to_string()),
                    start_line: 1,
                    end_line: 1,
                    metadata: serde_json::json!({}),
                })
                .await
                .unwrap();
        }
    }

    // Lexical match surfaces the chunk regardless of any vector window.
    let hits = store.search_lexical("lex", "zephyr", 10).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].file_path, "b.rs");
    assert!(hits[0].content.contains("zephyr"));
    assert!(hits[0].score > 0.0 && hits[0].score <= 1.0);

    // Project scoping: no hits from another project.
    store
        .create_project(&make_test_project("other", "Other", "/tmp/other"))
        .await
        .unwrap();
    let other_hits = store.search_lexical("other", "zephyr", 10).await.unwrap();
    assert!(other_hits.is_empty());

    // Trigger sync check: deleting the file's chunks removes them from FTS.
    store.delete_file_chunks("lex", file_ids[1]).await.unwrap();
    let post_delete = store.search_lexical("lex", "zephyr", 10).await.unwrap();
    assert!(post_delete.is_empty());
}

#[tokio::test]
async fn test_search_lexical_safe_against_match_syntax() {
    let store = test_store();
    store
        .create_project(&make_test_project("inj", "Inj", "/tmp/inj"))
        .await
        .unwrap();

    // FTS5 syntax characters must not error out the query path.
    let hits = store
        .search_lexical("inj", "\" OR * (column: NEAR/", 10)
        .await
        .unwrap();
    assert!(hits.is_empty());

    // Whitespace-only query short-circuits.
    let empty = store.search_lexical("inj", "   ", 10).await.unwrap();
    assert!(empty.is_empty());
}

// ---------------------------------------------------------------------------
// RAG R1: the FTS5 rescue leg must not be structurally capped. A strong
// keyword match scores well above the old 0.4·BM25norm ceiling, so pure
// keyword hits the embedding model missed can genuinely surface.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_search_lexical_strong_match_scores_high() {
    let store = test_store();
    store
        .create_project(&make_test_project("rescue", "Rescue", "/tmp/rescue"))
        .await
        .unwrap();

    // A realistic corpus: several chunks, only one containing the rare term.
    // A single-document corpus yields a near-zero FTS5 bm25 rank (IDF ~ 0),
    // which would not exercise the rescue leg meaningfully.
    for (path, chunks) in [
        (
            "a.rs",
            vec!["fn alpha() {}", "fn beta() {}", "fn gamma() {}"],
        ),
        (
            "b.rs",
            vec!["fn delta() {}", "fn epsilon() {}", "fn zeta() {}"],
        ),
        ("c.rs", vec!["fn handle_zephyr_shutdown() {}"]),
    ] {
        let file = FileRecord {
            id: None,
            project_id: "rescue".to_string(),
            relative_path: path.to_string(),
            file_hash: "h".to_string(),
            file_size: 10,
            modified_at: "2024-01-01".to_string(),
            chunk_count: chunks.len(),
        };
        let file_id = store.upsert_file(&file).await.unwrap();
        for (i, content) in chunks.iter().enumerate() {
            store
                .insert_chunk(&ChunkRow {
                    id: None,
                    project_id: "rescue".to_string(),
                    file_id,
                    chunk_index: i,
                    content: content.to_string(),
                    chunk_type: "code".to_string(),
                    language: Some("rust".to_string()),
                    start_line: 1,
                    end_line: 1,
                    metadata: serde_json::json!({}),
                })
                .await
                .unwrap();
        }
    }

    let hits = store.search_lexical("rescue", "zephyr", 10).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].content.contains("zephyr"));
    // A strong rare-term match must score above 0.4, proving the rescue leg
    // is not capped at 0.4·BM25norm.
    assert!(
        hits[0].score > 0.4,
        "strong lexical match should score > 0.4, got {}",
        hits[0].score
    );
}

// ---------------------------------------------------------------------------
// Regression: BM25 corpus stats must be scoped per project. The v4 tables
// were global, so IDF and average length were computed across all projects
// while doc_count was filtered per project — a division mismatch that
// corrupted hybrid scores with 2+ projects.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_corpus_stats_isolated_per_project() {
    let store = test_store();
    store
        .create_project(&make_test_project("pa", "A", "/tmp/pa"))
        .await
        .unwrap();
    store
        .create_project(&make_test_project("pb", "B", "/tmp/pb"))
        .await
        .unwrap();

    // Insert one chunk per project with distinct term sets and lengths.
    for (project, content) in [("pa", "alpha beta gamma delta epsilon"), ("pb", "alpha")] {
        let file = FileRecord {
            id: None,
            project_id: project.to_string(),
            relative_path: "f.rs".to_string(),
            file_hash: "h".to_string(),
            file_size: 10,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 1,
        };
        let file_id = store.upsert_file(&file).await.unwrap();
        store
            .insert_chunk(&ChunkRow {
                id: None,
                project_id: project.to_string(),
                file_id,
                chunk_index: 0,
                content: content.to_string(),
                chunk_type: "code".to_string(),
                language: Some("rust".to_string()),
                start_line: 1,
                end_line: 1,
                metadata: serde_json::json!({}),
            })
            .await
            .unwrap();
    }

    let pa = store.load_corpus_stats("pa").await.unwrap();
    let pb = store.load_corpus_stats("pb").await.unwrap();

    // doc_count is per project.
    assert_eq!(pa.doc_count, 1);
    assert_eq!(pb.doc_count, 1);

    // avg_doc_len must be per project: pa has 5 tokens, pb has 1. If the
    // tables were global, pa's average would be diluted by pb's short chunk.
    assert_eq!(pa.avg_doc_len, 5.0);
    assert_eq!(pb.avg_doc_len, 1.0);

    // doc_freq must be per project: "alpha" appears in both, but the
    // project-specific terms must not leak across.
    assert_eq!(pa.doc_freq.get("beta"), Some(&1));
    assert_eq!(pb.doc_freq.get("beta"), None);
    assert_eq!(pa.doc_freq.get("alpha"), Some(&1));
    assert_eq!(pb.doc_freq.get("alpha"), Some(&1));
}

// ---------------------------------------------------------------------------
// Regression: bm25_doc_freq must record *document* frequency — the number of
// chunks containing a term — not the term's total occurrence count. Occurrence
// counts can exceed doc_count and drive the BM25 IDF log argument negative.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_doc_freq_counts_documents_not_occurrences() {
    let store = test_store();
    store
        .create_project(&make_test_project("df", "DF", "/tmp/df"))
        .await
        .unwrap();

    let file = FileRecord {
        id: None,
        project_id: "df".to_string(),
        relative_path: "f.rs".to_string(),
        file_hash: "h".to_string(),
        file_size: 10,
        modified_at: "2024-01-01".to_string(),
        chunk_count: 2,
    };
    let file_id = store.upsert_file(&file).await.unwrap();

    // Chunk 1: "alpha" appears 3 times — still ONE document containing it.
    // Chunk 2: "alpha" once + "beta" once.
    for (chunk_index, content) in [(0, "alpha alpha alpha"), (1, "alpha beta")] {
        store
            .insert_chunk(&ChunkRow {
                id: None,
                project_id: "df".to_string(),
                file_id,
                chunk_index,
                content: content.to_string(),
                chunk_type: "code".to_string(),
                language: Some("rust".to_string()),
                start_line: 1,
                end_line: 1,
                metadata: serde_json::json!({}),
            })
            .await
            .unwrap();
    }

    let stats = store.load_corpus_stats("df").await.unwrap();
    assert_eq!(stats.doc_count, 2);
    // "alpha" is in 2 documents (not 4 occurrences); "beta" in 1.
    assert_eq!(stats.doc_freq.get("alpha"), Some(&2));
    assert_eq!(stats.doc_freq.get("beta"), Some(&1));
    // avg_doc_len uses token lengths (3 and 2) as before.
    assert_eq!(stats.avg_doc_len, 2.5);
}

// ---------------------------------------------------------------------------
// Regression: deleting a file (stale-file cleanup during reindex) must remove
// its chunks' BM25 stats. Previously `delete_file` bypassed the stats tables,
// leaving stale doc_freq/doc_len entries that inflated IDF and avg_doc_len.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_delete_file_removes_corpus_stats() {
    let store = test_store();
    store
        .create_project(&make_test_project("pdel", "PD", "/tmp/pdel"))
        .await
        .unwrap();

    let mut file_ids = Vec::new();
    for (name, content) in [("a.rs", "apple banana"), ("b.rs", "cherry durian")] {
        let file = FileRecord {
            id: None,
            project_id: "pdel".to_string(),
            relative_path: name.to_string(),
            file_hash: "h".to_string(),
            file_size: 10,
            modified_at: "2024-01-01".to_string(),
            chunk_count: 1,
        };
        let file_id = store.upsert_file(&file).await.unwrap();
        file_ids.push(file_id);
        store
            .insert_chunk(&ChunkRow {
                id: None,
                project_id: "pdel".to_string(),
                file_id,
                chunk_index: 0,
                content: content.to_string(),
                chunk_type: "code".to_string(),
                language: Some("rust".to_string()),
                start_line: 1,
                end_line: 1,
                metadata: serde_json::json!({}),
            })
            .await
            .unwrap();
    }

    // Delete the second file (the stale-cleanup path used by reindex).
    store.delete_file(file_ids[1]).await.unwrap();

    let stats = store.load_corpus_stats("pdel").await.unwrap();
    assert_eq!(stats.doc_count, 1);
    // Deleted chunk's terms must not linger in the stats.
    assert_eq!(stats.doc_freq.get("cherry"), None);
    assert_eq!(stats.doc_freq.get("durian"), None);
    assert_eq!(stats.doc_freq.get("apple"), Some(&1));
    assert_eq!(stats.doc_freq.get("banana"), Some(&1));
    // avg_doc_len must reflect only the surviving 2-token chunk.
    assert_eq!(stats.avg_doc_len, 2.0);
}
