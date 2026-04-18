use tauri::Manager;

pub mod commands;
pub mod logger;
pub mod ollama_url;
pub mod payloads;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::info!("Starting Musaed application");

    let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        log::info!("Second instance attempted with args: {:?} and cwd: {:?}", args, cwd);

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
        // Fixed: pass app.handle() instead of app
        if let Err(e) = logger::init_file_logger(app.handle()) {
            eprintln!("⚠️ Failed to initialize file logger: {}", e);
        }

        #[cfg(debug_assertions)]
        {
            let mut builder = env_logger::Builder::new();
            builder.filter_level(log::LevelFilter::Debug);
            let _ = builder.try_init();
            log::debug!("Debug console logging enabled");
        }

        Ok(())
    });

    builder
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
