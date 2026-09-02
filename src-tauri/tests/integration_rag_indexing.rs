//! Integration tests for the full RAG indexing pipeline.
//!
//! These tests exercise `index_project()` end-to-end with real async Tokio,
//! real filesystem I/O, and a real SQLite store. The only mock is at the
//! HTTP boundary: a mockito server standing in for Ollama's `/api/embed`.

use musaed_lib::rag::error::RagError;
use musaed_lib::rag::indexing::{index_project, IndexOptions};
use musaed_lib::rag::store::RagStore;
use musaed_lib::rag::types::ProjectStatus;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

// ====================== HELPERS ======================

/// Create a mock Tauri `AppHandle` (MockRuntime — no real event loop, window,
/// or OS interaction). Works on test threads where Wry's event loop would
/// panic. `index_project` is generic over `R: Runtime` exactly to allow this.
fn mock_handle() -> tauri::AppHandle<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.handle().clone()
}

/// Open a fresh RagStore inside the given temp directory.
fn test_store(tmp: &TempDir) -> Arc<RwLock<RagStore>> {
    let db_path = tmp.path().join("rag_test.db");
    let store = RagStore::open(&db_path).expect("Failed to open test store");
    Arc::new(RwLock::new(store))
}

/// Create a project row in the store and return its generated ID.
async fn create_project(
    store: &Arc<RwLock<RagStore>>,
    name: &str,
    path: &str,
    model: &str,
    ignore_patterns: &[String],
) -> String {
    let s = store.write().await;
    s.create_project_with_params(name, path, model, ignore_patterns)
        .await
        .expect("Failed to create test project")
        .id
}

/// Spin up a mockito server that answers Ollama `POST /api/embed` calls.
/// The response body is generated per-request so the embeddings vector
/// length always matches the batch's input count.
async fn mock_embed_server(dimension: usize) -> (mockito::ServerGuard, mockito::Mock) {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/api/embed")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body_from_request(move |req| {
            let parsed: serde_json::Value = req
                .utf8_lossy_body()
                .ok()
                .and_then(|b| serde_json::from_str(&b).ok())
                .unwrap_or_else(|| serde_json::json!({"input": []}));
            let count = parsed["input"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(1)
                .max(1);
            let embeddings: Vec<Vec<f32>> = (0..count)
                .map(|i| {
                    let mut v = vec![0.0f32; dimension];
                    v[i % dimension] = 1.0;
                    v
                })
                .collect();
            serde_json::json!({"embeddings": embeddings})
                .to_string()
                .into_bytes()
        })
        .create_async()
        .await;
    (server, mock)
}

/// Request-counting variant of [`mock_embed_server`]; every `/api/embed`
/// call bumps the returned counter, letting tests assert exactly how many
/// embedding round-trips a pipeline run performed.
async fn mock_embed_server_counting(
    dimension: usize,
    counter: Arc<std::sync::atomic::AtomicUsize>,
) -> (mockito::ServerGuard, mockito::Mock) {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/api/embed")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body_from_request(move |req| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let parsed: serde_json::Value = req
                .utf8_lossy_body()
                .ok()
                .and_then(|b| serde_json::from_str(&b).ok())
                .unwrap_or_else(|| serde_json::json!({"input": []}));
            let count = parsed["input"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(1)
                .max(1);
            let embeddings: Vec<Vec<f32>> = (0..count)
                .map(|i| {
                    let mut v = vec![0.0f32; dimension];
                    v[i % dimension] = 1.0;
                    v
                })
                .collect();
            serde_json::json!({"embeddings": embeddings})
                .to_string()
                .into_bytes()
        })
        .create_async()
        .await;
    (server, mock)
}

fn mock_url(server: &mockito::ServerGuard) -> String {
    server.url().trim_end_matches('/').to_string()
}

/// Write `count` small text files into `dir`; returns their file names.
fn create_text_files(dir: &Path, count: usize, prefix: &str) {
    for i in 0..count {
        let name = format!("{prefix}_{i:04}.txt");
        let content = format!(
            "Document {i} about various topics.\n\
             This is the main content paragraph for testing.\n\
             A third line for good measure.\n"
        );
        std::fs::write(dir.join(&name), content).expect("Failed to write test file");
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_pipeline(
    store: &Arc<RwLock<RagStore>>,
    project_id: &str,
    project_path: &str,
    model: &str,
    base_url: &str,
    force: bool,
    ignore_patterns: &[String],
    cancel_token: Arc<CancellationToken>,
) -> Result<(), RagError> {
    index_project(
        store.clone(),
        IndexOptions {
            project_id,
            project_path,
            embedding_model: model,
            base_url,
            ignore_patterns,
            force,
        },
        cancel_token,
        mock_handle(),
    )
    .await
}

async fn project_status(store: &Arc<RwLock<RagStore>>, project_id: &str) -> ProjectStatus {
    store
        .read()
        .await
        .get_project(project_id)
        .await
        .unwrap()
        .expect("project should exist")
        .status
}

// ==================== 1. SMALL PROJECT ====================

#[tokio::test]
async fn test_index_small_project_success() {
    let tmp = TempDir::new().unwrap();
    let path_str = tmp.path().to_str().unwrap().to_string();
    let store = test_store(&tmp);
    let proj_id = create_project(&store, "small", &path_str, "test-model", &[]).await;
    create_text_files(tmp.path(), 5, "doc");

    let (server, _mock) = mock_embed_server(768).await;
    let result = run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "test-model",
        &mock_url(&server),
        false,
        &[],
        Arc::new(CancellationToken::new()),
    )
    .await;

    assert!(result.is_ok(), "indexing failed: {:?}", result.err());
    assert_eq!(project_status(&store, &proj_id).await, ProjectStatus::Ready);

    let s = store.read().await;
    let files = s.get_project_files(&proj_id).await.unwrap();
    assert_eq!(files.len(), 5, "all 5 files must be indexed");

    for file in &files {
        let chunks = s.get_file_chunks(file.id.unwrap()).await.unwrap();
        assert!(
            !chunks.is_empty(),
            "{} produced no chunks",
            file.relative_path
        );
    }

    let stats = s.get_project_stats(&proj_id).await.unwrap();
    assert_eq!(stats.file_count, 5);
    assert!(stats.chunk_count >= 5);
    assert_eq!(stats.embedding_dimension, 768);

    // Searchable: unit vector at index 0 matches first mock embedding exactly.
    let mut query = vec![0.0f32; 768];
    query[0] = 1.0;
    let results = s.search_similar(&proj_id, &query, 10, 0.0).await.unwrap();
    assert!(!results.is_empty(), "indexed content must be searchable");
}

// ==================== 2. LARGE PROJECT ====================

#[tokio::test]
async fn test_index_large_project() {
    let tmp = TempDir::new().unwrap();
    let path_str = tmp.path().to_str().unwrap().to_string();
    let store = test_store(&tmp);
    let proj_id = create_project(&store, "large", &path_str, "test-model", &[]).await;
    create_text_files(tmp.path(), 1002, "file");

    let (server, _mock) = mock_embed_server(768).await;
    let result = run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "test-model",
        &mock_url(&server),
        false,
        &[],
        Arc::new(CancellationToken::new()),
    )
    .await;

    assert!(
        result.is_ok(),
        "indexing 1002 files must not panic/OOM: {:?}",
        result.err()
    );
    assert_eq!(project_status(&store, &proj_id).await, ProjectStatus::Ready);

    let s = store.read().await;
    let stats = s.get_project_stats(&proj_id).await.unwrap();
    assert_eq!(stats.file_count, 1002);
    assert!(
        stats.chunk_count >= 1002,
        "expected at least one chunk per file, got {}",
        stats.chunk_count
    );
}

// ==================== 3. CANCEL MID-PIPELINE ====================

#[tokio::test]
async fn test_cancel_indexing_mid_pipeline() {
    let tmp = TempDir::new().unwrap();
    let path_str = tmp.path().to_str().unwrap().to_string();
    let store = test_store(&tmp);
    let proj_id = create_project(&store, "cancel", &path_str, "test-model", &[]).await;
    create_text_files(tmp.path(), 150, "target");

    // Slow mock: 100ms per request keeps the embed phase alive well past
    // the 500ms cancel deadline (150 chunks → 3 batches ≈ 300ms, plus
    // discover/diff/chunk time).
    let mut server = mockito::Server::new_async().await;
    let _mock = server
        .mock("POST", "/api/embed")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body_from_request(|req| {
            std::thread::sleep(Duration::from_millis(100));
            let parsed: serde_json::Value = req
                .utf8_lossy_body()
                .ok()
                .and_then(|b| serde_json::from_str(&b).ok())
                .unwrap_or_else(|| serde_json::json!({"input": []}));
            let count = parsed["input"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(1)
                .max(1);
            let embeddings: Vec<Vec<f32>> = (0..count)
                .map(|i| {
                    let mut v = vec![0.0f32; 768];
                    v[i % 768] = 1.0;
                    v
                })
                .collect();
            serde_json::json!({"embeddings": embeddings})
                .to_string()
                .into_bytes()
        })
        .create_async()
        .await;

    let cancel = Arc::new(CancellationToken::new());
    let cancel_clone = cancel.clone();
    let cancel_task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        cancel_clone.cancel();
    });

    let result = run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "test-model",
        &mock_url(&server),
        false,
        &[],
        cancel,
    )
    .await;
    cancel_task.await.unwrap();

    let status = project_status(&store, &proj_id).await;
    assert_ne!(
        status,
        ProjectStatus::Indexing,
        "project must not be stuck in Indexing after cancel"
    );
    if result.is_err() {
        assert_eq!(
            status,
            ProjectStatus::Error,
            "cancelled run must leave status Error, got {status:?}"
        );
    }
}

// ==================== 4. INCREMENTAL REINDEX ====================

#[tokio::test]
async fn test_reindex_after_file_changes() {
    let tmp = TempDir::new().unwrap();
    let path_str = tmp.path().to_str().unwrap().to_string();
    let store = test_store(&tmp);
    let proj_id = create_project(&store, "incr", &path_str, "test-model", &[]).await;
    create_text_files(tmp.path(), 10, "doc");

    let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (server, _mock) = mock_embed_server_counting(768, counter.clone()).await;
    let base_url = mock_url(&server);

    run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "test-model",
        &base_url,
        false,
        &[],
        Arc::new(CancellationToken::new()),
    )
    .await
    .expect("first index must succeed");

    let before: std::collections::HashMap<String, String> = {
        store
            .read()
            .await
            .get_project_files(&proj_id)
            .await
            .unwrap()
            .into_iter()
            .map(|f| (f.relative_path, f.file_hash))
            .collect()
    };
    assert_eq!(before.len(), 10);
    let hits_before = counter.load(std::sync::atomic::Ordering::SeqCst);

    // Rewrite 3 files so their content hashes change.
    for name in ["doc_0000.txt", "doc_0003.txt", "doc_0007.txt"] {
        std::fs::write(
            tmp.path().join(name),
            format!("UPDATED content for {name}\nThis file was modified after indexing.\n"),
        )
        .unwrap();
    }

    run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "test-model",
        &base_url,
        false,
        &[],
        Arc::new(CancellationToken::new()),
    )
    .await
    .expect("incremental reindex must succeed");

    assert_eq!(project_status(&store, &proj_id).await, ProjectStatus::Ready);

    let after: std::collections::HashMap<String, String> = {
        store
            .read()
            .await
            .get_project_files(&proj_id)
            .await
            .unwrap()
            .into_iter()
            .map(|f| (f.relative_path, f.file_hash))
            .collect()
    };

    let changed: Vec<_> = after
        .iter()
        .filter(|(path, hash)| before.get(*path) != Some(hash))
        .map(|(p, _)| p.clone())
        .collect();
    assert_eq!(
        changed.len(),
        3,
        "only the 3 modified files must be re-indexed, got: {changed:?}"
    );

    // detect_dimension always fires; the re-run embeds exactly the 3 changed
    // files (1 chunk each) in one batch → exactly 2 extra HTTP calls.
    let hits_after = counter.load(std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        hits_after - hits_before,
        2,
        "reindex must embed only changed files"
    );
}

// ==================== 5. SWITCH EMBEDDING MODEL ====================

#[tokio::test]
async fn test_switch_embedding_model() {
    let tmp = TempDir::new().unwrap();
    let path_str = tmp.path().to_str().unwrap().to_string();
    let store = test_store(&tmp);
    let proj_id = create_project(&store, "switch", &path_str, "model-a", &[]).await;
    create_text_files(tmp.path(), 5, "m");

    // First index against model A (384-dim).
    let (server_a, _mock_a) = mock_embed_server(384).await;
    run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "model-a",
        &mock_url(&server_a),
        false,
        &[],
        Arc::new(CancellationToken::new()),
    )
    .await
    .expect("index with model A must succeed");

    {
        let s = store.read().await;
        let dim = s.get_embedding_dimension(&proj_id).await.unwrap();
        assert_eq!(dim, 384, "dimension must reflect model A");
    }

    // Switch model in the DB, then force-reindex against model B (512-dim).
    {
        let s = store.write().await;
        s.update_embedding_model(&proj_id, "model-b").await.unwrap();
    }

    let (server_b, _mock_b) = mock_embed_server(512).await;
    run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "model-b",
        &mock_url(&server_b),
        true,
        &[],
        Arc::new(CancellationToken::new()),
    )
    .await
    .expect("reindex with model B must succeed");

    let s = store.read().await;
    let project = s.get_project(&proj_id).await.unwrap().unwrap();
    assert_eq!(project.embedding_model, "model-b");
    assert_eq!(project.status, ProjectStatus::Ready);
    let dim = s.get_embedding_dimension(&proj_id).await.unwrap();
    assert_eq!(dim, 512, "dimension must reflect model B after reindex");
}

// ==================== 6. IGNORE PATTERNS ====================

#[tokio::test]
async fn test_index_with_ignore_patterns() {
    let tmp = TempDir::new().unwrap();
    let path_str = tmp.path().to_str().unwrap().to_string();
    let ignore = vec!["*.log".to_string(), "drafts/**".to_string()];
    let store = test_store(&tmp);
    let proj_id = create_project(&store, "ign", &path_str, "test-model", &ignore).await;

    // Indexable files (2).
    create_text_files(tmp.path(), 2, "keep");
    // Files excluded by user-supplied ignore patterns.
    std::fs::create_dir_all(tmp.path().join("drafts")).unwrap();
    std::fs::write(tmp.path().join("drafts/notes.txt"), "draft\n").unwrap();
    std::fs::write(tmp.path().join("run.log"), "log line\n").unwrap();
    // Files excluded by built-in ALWAYS_IGNORE (.pem, node_modules).
    std::fs::create_dir_all(tmp.path().join("node_modules/pkg")).unwrap();
    std::fs::write(tmp.path().join("node_modules/pkg/index.js"), "x=1\n").unwrap();
    std::fs::write(tmp.path().join("secret.pem"), "PEM DATA\n").unwrap();

    let (server, _mock) = mock_embed_server(768).await;
    let result = run_pipeline(
        &store,
        &proj_id,
        &path_str,
        "test-model",
        &mock_url(&server),
        false,
        &ignore,
        Arc::new(CancellationToken::new()),
    )
    .await;

    assert!(result.is_ok(), "indexing failed: {:?}", result.err());
    assert_eq!(project_status(&store, &proj_id).await, ProjectStatus::Ready);

    let s = store.read().await;
    let files = s.get_project_files(&proj_id).await.unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();

    assert_eq!(
        files.len(),
        2,
        "only the 2 keep files may be indexed, got {paths:?}"
    );
    assert!(paths.iter().all(|p| p.starts_with("keep_")));
    assert!(!paths.iter().any(|p| p.ends_with(".log")));
    assert!(!paths.iter().any(|p| p.contains("drafts")));
    assert!(!paths.iter().any(|p| p.contains("node_modules")));
    assert!(!paths.iter().any(|p| p.ends_with(".pem")));
}
