pub mod commands;
pub mod payloads;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    #[cfg(not(debug_assertions))]
    env_logger::init();

    #[cfg(debug_assertions)]
    {
        env_logger::builder()
        .filter_level(log::LevelFilter::Debug)
        .init();
    }

    log::info!("Starting Musaed application");

    tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
        commands::get_ollama_models,
        commands::chat_with_ollama,
        commands::abort_chat,
        commands::validate_model,
        commands::pull_model,
        commands::delete_model,
        commands::check_ollama_health,
        commands::append_to_log,
        commands::clear_logs,
        commands::select_and_extract_files,
        commands::select_and_extract_folder,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
