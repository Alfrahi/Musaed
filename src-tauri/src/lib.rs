use tauri::Manager;

pub mod logger;
pub mod logging;
pub mod ollama;
pub mod ollama_url;
pub mod payloads;
pub mod shared;

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
        ollama::get_ollama_models,
        ollama::chat_with_ollama,
        ollama::abort_chat,
        ollama::validate_model,
        ollama::pull_model,
        ollama::delete_model,
        ollama::check_ollama_health,
        logging::append_to_log,
        logging::clear_logs,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
