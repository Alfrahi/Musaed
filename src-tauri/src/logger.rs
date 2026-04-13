use log::LevelFilter;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::Manager;

static FILE_LOGGER: OnceLock<FileLogger> = OnceLock::new();

pub struct FileLogger {
    file: Mutex<std::fs::File>,
}

impl FileLogger {
    pub fn new(log_path: PathBuf) -> std::io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(log_path)?;
        Ok(Self { file: Mutex::new(file) })
    }

    pub fn global() -> &'static FileLogger {
        FILE_LOGGER.get().expect("Logger not initialized")
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= LevelFilter::Info
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) { return; }
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let message = format!("[{}] {} - {}\n", timestamp, record.level(), record.args());
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(message.as_bytes());
            let _ = file.flush();
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

pub fn init_file_logger<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let data_dir = app.path().app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let log_dir = data_dir.join("musaed").join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let log_path = log_dir.join("musaed.log");

    let logger = FileLogger::new(log_path.clone())
    .map_err(|e| format!("Failed to create log file: {}", e))?;

    FILE_LOGGER.set(logger).map_err(|_| "Logger already initialized".to_string())?;

    log::set_boxed_logger(Box::new(FileLogger::global()))
    .map_err(|e| format!("Failed to set logger: {}", e))?;

    log::set_max_level(LevelFilter::Info);
    log::info!("✅ File logger initialized at: {}", log_path.display());
    Ok(())
}
