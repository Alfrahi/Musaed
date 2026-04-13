pub mod commands;
pub mod payloads;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            commands::pull_model,
            commands::delete_model,
            commands::append_to_log,
            commands::clear_logs,
            commands::select_and_extract_files,
            commands::select_and_extract_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}