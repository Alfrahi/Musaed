use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing_subscriber::layer::SubscriberExt;

pub mod generated_validation;
pub mod logger;
pub mod logging;
pub mod ollama;
pub mod ollama_url;
pub mod payloads;
pub mod rag;
pub mod rate_limiter;
pub mod shared;
pub mod validation;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::info!("Starting Musaed application");

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            tracing::info!(
                "Second instance attempted with args: {:?} and cwd: {:?}",
                args,
                cwd
            );

            // Focus the existing main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                let _ = window.show();
                tracing::info!("Focused existing main window");
            } else {
                tracing::warn!("Main window not found when attempting to focus");
            }
        }));

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder = builder.setup(|app| -> Result<(), Box<dyn std::error::Error>> {
        // Initialize file logger and get the channel sender for tracing
        let log_tx = logger::init_file_logger(app.handle())
            .map_err(|e| format!("Failed to initialize file logger: {}", e))?;

        // Create a tracing layer that forwards events to the log channel
        let tracing_layer = logger::TracingLayer::new(log_tx);
        let subscriber = tracing_subscriber::Registry::default().with(tracing_layer);
        tracing::subscriber::set_global_default(subscriber)
            .map_err(|e| format!("Failed to set tracing subscriber: {}", e))?;

        shared::spawn_cache_eviction_task();

        // Initialize RAG store
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data directory: {}", e))?;
        let rag_dir = app_data_dir.join("musaed").join("rag");
        std::fs::create_dir_all(&rag_dir)
            .map_err(|e| format!("Failed to create RAG data directory: {}", e))?;
        let db_path = rag_dir.join("rag.sqlite3");

        let rag_store = rag::store::RagStore::open(&db_path)
            .map_err(|e| format!("Failed to initialize RAG store: {}", e))?;
        app.manage(Arc::new(Mutex::new(rag_store)));

        tracing::info!("RAG store initialized at {:?}", db_path);

        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![
            ollama::commands::cmd_ollama_chat,
            ollama::commands::cmd_ollama_abort_chat,
            ollama::commands::cmd_ollama_check_health,
            ollama::models::cmd_ollama_get_models,
            ollama::models::cmd_ollama_validate_model,
            ollama::models::cmd_ollama_pull_model,
            ollama::models::cmd_ollama_abort_pull,
            ollama::models::cmd_ollama_delete_model,
            ollama::models::cmd_ollama_verify_service,
            ollama::title::cmd_ollama_generate_title,
            logging::cmd_logs_append,
            logging::cmd_logs_request_clear_token,
            logging::cmd_logs_clear,
            rag::commands::cmd_rag_add_project,
            rag::commands::cmd_rag_remove_project,
            rag::commands::cmd_rag_update_project,
            rag::commands::cmd_rag_list_projects,
            rag::commands::cmd_rag_get_project,
            rag::commands::cmd_rag_abort_index,
            rag::commands::cmd_rag_index_project,
            rag::commands::cmd_rag_reindex_project,
            rag::commands::cmd_rag_get_index_status,
            rag::commands::cmd_rag_search,
            rag::commands::cmd_rag_get_file_chunks,
            rag::commands::cmd_rag_get_project_stats,
            rag::commands::cmd_rag_set_embedding_model,
            rag::commands::cmd_rag_validate_embedding_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
