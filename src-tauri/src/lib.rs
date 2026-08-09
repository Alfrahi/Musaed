use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};
use tracing_subscriber::layer::SubscriberExt;

pub mod app_info;
pub mod context_menu;
pub mod conversation;
pub mod dialog;
pub mod error_codes;
pub mod fs_commands;
pub mod generated_validation;
pub mod logging;
pub mod menu_bar;
pub mod migrations;
pub mod ollama;
pub mod ollama_url;
pub mod opener;
pub mod payloads;
pub mod rag;
pub mod rate_limiter;
pub mod shared;
pub mod store_commands;
pub mod tray;
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

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                let _ = window.show();
                log::info!("Focused existing main window");
            } else {
                log::warn!("Main window not found when attempting to focus");
            }
        }));

    // Intercept window close: if background tasks (chat stream, model pull,
    // RAG indexing) are active, hide to tray instead of exiting.
    builder = builder.on_window_event(|window, event| {
        tray::on_window_event(window, event);
    });

    builder = builder.setup(|app| -> Result<(), Box<dyn std::error::Error>> {
        let log_tx = logging::init_file_logger(app.handle())
            .map_err(|e| format!("Failed to initialize file logger: {}", e))?;

        // Create a tracing layer that forwards events to the log channel
        let tracing_layer = logging::TracingLayer::new(log_tx);
        let subscriber = tracing_subscriber::Registry::default().with(tracing_layer);
        tracing::subscriber::set_global_default(subscriber)
            .map_err(|e| format!("Failed to set tracing subscriber: {}", e))?;

        // Skip cache eviction task during tests - the infinite background loop
        // interferes with tokio test runtimes configured with worker_threads = 1
        #[cfg(not(test))]
        shared::spawn_cache_eviction_task();
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data directory: {}", e))?;
        let conversation_dir = app_data_dir.join("musaed").join("conversations");
        std::fs::create_dir_all(&conversation_dir)
            .map_err(|e| format!("Failed to create conversation data directory: {}", e))?;
        let db_path = conversation_dir.join("conversations.sqlite3");

        let conversation_store = crate::conversation::store::ConversationStore::new(&db_path)
            .map_err(|e| format!("Failed to initialize conversation store: {}", e))?;
        app.manage(Arc::new(Mutex::new(conversation_store)));

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
        app.manage(Arc::new(RwLock::new(rag_store)));

        log::info!("RAG store initialized at {:?}", db_path);

        // Tray icon + menu + close interception for background task protection.
        tray::setup_tray(app.handle())
            .map_err(|e| format!("Failed to initialize system tray: {}", e))?;

        // Native macOS menu bar. No-op on Windows/Linux.
        menu_bar::setup_menu_bar(app.handle())
            .map_err(|e| format!("Failed to initialize menu bar: {}", e))?;

        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![
            app_info::cmd_get_app_version,
            ollama::commands::cmd_ollama_chat,
            ollama::commands::cmd_ollama_abort_chat,
            ollama::commands::cmd_ollama_check_health,
            ollama::models::cmd_ollama_get_models,
            ollama::models::cmd_ollama_pull_model,
            ollama::models::cmd_ollama_abort_pull,
            ollama::models::cmd_ollama_delete_model,
            ollama::models::cmd_ollama_verify_service,
            ollama::models::cmd_ollama_validate_model,
            ollama::title::cmd_ollama_generate_title,
            logging::commands::cmd_logs_append,
            logging::commands::cmd_logs_request_clear_token,
            logging::commands::cmd_logs_clear,
            logging::commands::cmd_trace_append,
            logging::commands::cmd_trace_start,
            logging::commands::cmd_trace_complete,
            logging::commands::cmd_trace_get_context,
            migrations::cmd_run_migrations,
            migrations::cmd_rollback_migrations,
            migrations::cmd_get_migration_status,
            migrations::cmd_list_migrations,
            rag::commands::cmd_rag_add_project,
            rag::commands::cmd_rag_remove_project,
            rag::commands::cmd_rag_update_project,
            rag::commands::cmd_rag_list_projects,
            rag::commands::cmd_rag_abort_index,
            rag::commands::cmd_rag_index_project,
            rag::commands::cmd_rag_reindex_project,
            rag::commands::cmd_rag_retry_index_project,
            rag::commands::cmd_rag_search,
            rag::commands::cmd_rag_get_file_chunks,
            rag::commands::cmd_rag_list_files,
            rag::commands::cmd_rag_set_embedding_model,
            rag::commands::cmd_rag_assemble_context,
            conversation::commands::cmd_conversations_list,
            conversation::commands::cmd_conversation_get,
            conversation::commands::cmd_conversation_create,
            conversation::commands::cmd_message_append,
            conversation::commands::cmd_message_delete,
            conversation::commands::cmd_conversation_delete,
            conversation::commands::cmd_conversations_clear,
            conversation::commands::cmd_conversation_update,
            conversation::commands::cmd_conversation_search,
            context_menu::cmd_context_menu_show,
            tray::cmd_tray_get_background_status,
            menu_bar::cmd_menu_rebuild,
            dialog::cmd_dialog_ask,
            dialog::cmd_dialog_open_file,
            dialog::cmd_dialog_save_file,
            opener::cmd_opener_open_url,
            store_commands::cmd_store_load,
            store_commands::cmd_store_get,
            store_commands::cmd_store_set,
            store_commands::cmd_store_save,
            store_commands::cmd_store_delete,
            fs_commands::cmd_fs_read_text_file,
            fs_commands::cmd_fs_read_file,
            fs_commands::cmd_fs_write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
