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
            ollama::commands::chat_with_ollama,
            ollama::commands::abort_chat,
            ollama::commands::check_ollama_health,
            ollama::models::get_ollama_models,
            ollama::models::validate_model,
            ollama::models::pull_model,
            ollama::models::abort_pull,
            ollama::models::delete_model,
            ollama::models::verify_ollama_service,
            ollama::title::generate_title,
            logging::append_to_log,
            logging::clear_logs,
            rag::commands::rag_add_project,
            rag::commands::rag_remove_project,
            rag::commands::rag_update_project,
            rag::commands::rag_list_projects,
            rag::commands::rag_get_project,
            rag::commands::rag_index_project,
            rag::commands::rag_abort_index,
            rag::commands::rag_reindex_project,
            rag::commands::rag_get_index_status,
            rag::commands::rag_search,
            rag::commands::rag_get_file_chunks,
            rag::commands::rag_get_project_stats,
            rag::commands::rag_set_embedding_model,
            rag::commands::rag_validate_embedding_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
