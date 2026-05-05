use tauri::Manager;
use std::sync::Arc;
use tokio::sync::Mutex;

pub mod logger;
pub mod logging;
pub mod ollama;
pub mod ollama_url;
pub mod payloads;
pub mod rag;
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
            log::info!(
                "Second instance attempted with args: {:?} and cwd: {:?}",
                args,
                cwd
            );

            // Focus the existing main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                let _ = window.show();
                log::info!("Focused existing main window");
            } else {
                log::warn!("Main window not found when attempting to focus");
            }
        }));

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder = builder.setup(|app| {
        if let Err(e) = logger::init_file_logger(app.handle()) {
            eprintln!("⚠️ Failed to initialize file logger: {}", e);
        }

        shared::spawn_cache_eviction_task();

        // Initialize RAG store
        let app_data_dir = app
            .path()
            .app_data_dir()
            .expect("Failed to resolve app data directory");
        let rag_dir = app_data_dir.join("musaed").join("rag");
        std::fs::create_dir_all(&rag_dir).expect("Failed to create RAG data directory");
        let db_path = rag_dir.join("rag.sqlite3");

        let rag_store = rag::store::RagStore::open(&db_path)
            .expect("Failed to initialize RAG store");
        app.manage(Arc::new(Mutex::new(rag_store)));

        log::info!("RAG store initialized at {:?}", db_path);

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
            logging::cmd_logs_clear,
            rag::commands::cmd_rag_add_project,
            rag::commands::cmd_rag_remove_project,
            rag::commands::cmd_rag_update_project,
            rag::commands::cmd_rag_list_projects,
            rag::commands::cmd_rag_get_project,
            rag::commands::cmd_rag_index_project,
            rag::commands::cmd_rag_abort_index,
            rag::commands::cmd_rag_reindex_project,
            rag::commands::cmd_rag_get_index_status,
            rag::commands::cmd_rag_search,
            rag::commands::cmd_rag_get_file_chunks,
            rag::commands::cmd_cmd_rag_get_project_stats,
            rag::commands::cmd_rag_set_embedding_model,
            rag::commands::cmd_rag_validate_embedding_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
