//! Core logger implementation for Musaed's structured tracing domain.
//!
//! This module provides the channel-based logging infrastructure that
//! supports both `log` and `tracing` crates through a unified backend.

use chrono;
use log::LevelFilter;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::OnceLock;
use tauri::Manager;
use tracing::field::{Field, Visit};
use tracing::{self, Event, Subscriber};
use tracing_subscriber::layer::Layer;

static LOGGER: OnceLock<ChannelLogger> = OnceLock::new();

/// Envelope for log messages sent through the channel.
pub enum LogMsg {
    Line(String),
    Flush,
}

/// Visitor to collect fields from a tracing event.
#[derive(Default)]
struct Fields {
    parts: Vec<String>,
}

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.parts.push(format!("{}: {}", field.name(), value));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.parts.push(format!("{}: {:?}", field.name(), value));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.parts.push(format!("{}: {}", field.name(), value));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.parts.push(format!("{}: {}", field.name(), value));
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.parts.push(format!("{}: {}", field.name(), value));
    }
}

/// A tracing layer that forwards events to the ChannelLogger's channel.
pub struct TracingLayer {
    tx: mpsc::Sender<LogMsg>,
}

impl TracingLayer {
    /// Create a new TracingLayer with a sender.
    pub fn new(tx: mpsc::Sender<LogMsg>) -> Self {
        Self { tx }
    }
}

impl<S> Layer<S> for TracingLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _ctx: tracing_subscriber::layer::Context<'_, S>) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let level = event.metadata().level();
        let mut fields = Fields::default();
        event.record(&mut fields);
        let message = if fields.parts.is_empty() {
            format!("[{}] {}\n", timestamp, level)
        } else {
            format!("[{}] {} - {}\n", timestamp, level, fields.parts.join(", "))
        };
        let _ = self.tx.send(LogMsg::Line(message));
    }
}

pub struct ChannelLogger {
    tx: mpsc::Sender<LogMsg>,
}

impl ChannelLogger {
    fn new(tx: mpsc::Sender<LogMsg>) -> Self {
        Self { tx }
    }

    pub fn global() -> &'static ChannelLogger {
        LOGGER.get().expect("Logger not initialized")
    }

    /// Send a pre-formatted line directly through the channel.
    /// Used by logging commands to route frontend entries through the same writer.
    pub fn log_direct(line: String) {
        if let Some(logger) = LOGGER.get() {
            let _ = logger.tx.send(LogMsg::Line(line));
        }
    }

    /// Request a flush of pending log writes.
    pub fn flush(&self) {
        let _ = self.tx.send(LogMsg::Flush);
    }
}

impl log::Log for ChannelLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= LevelFilter::Info
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let message = format!("[{}] {} - {}\n", timestamp, record.level(), record.args());

        let _ = self.tx.send(LogMsg::Line(message.clone()));

        #[cfg(debug_assertions)]
        {
            let _ = std::io::stderr().write_all(message.as_bytes());
            let _ = std::io::stderr().flush();
        }
    }

    fn flush(&self) {
        let _ = self.tx.send(LogMsg::Flush);
    }
}

/// Background writer thread: owns the file handle, drains the channel, and
/// flushes periodically to avoid per-write syscall overhead.
fn writer_thread(mut file: std::fs::File, rx: mpsc::Receiver<LogMsg>) {
    // Flush every N messages to amortize syscall cost.
    const FLUSH_INTERVAL: usize = 64;
    let mut unflushed: usize = 0;

    for msg in rx.iter() {
        match msg {
            LogMsg::Line(line) => {
                let _ = file.write_all(line.as_bytes());
                unflushed += 1;
                if unflushed >= FLUSH_INTERVAL {
                    let _ = file.flush();
                    unflushed = 0;
                }
            }
            LogMsg::Flush => {
                let _ = file.flush();
                unflushed = 0;
            }
        }
    }
}

/// Resolves the path to the application log file, creating directories if needed.
pub fn get_log_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let log_dir = data_dir.join("musaed").join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    Ok(log_dir.join("musaed.log"))
}

/// Initializes the file logger and returns the channel sender.
/// This sender can be used to create a tracing layer.
pub fn init_file_logger<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<mpsc::Sender<LogMsg>, String> {
    let log_path = get_log_path(app)?;

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to create log file: {}", e))?;

    let (tx, rx) = mpsc::channel::<LogMsg>();

    std::thread::Builder::new()
        .name("musaed-log-writer".into())
        .spawn(move || writer_thread(file, rx))
        .map_err(|e| format!("Failed to spawn log writer thread: {}", e))?;

    let logger = ChannelLogger::new(tx);

    LOGGER
        .set(logger)
        .map_err(|_| "Logger already initialized".to_string())?;

    log::set_boxed_logger(Box::new(ChannelLogger::global()))
        .map_err(|e| format!("Failed to set logger: {}", e))?;

    #[cfg(debug_assertions)]
    {
        log::set_max_level(LevelFilter::Debug);
    }
    #[cfg(not(debug_assertions))]
    {
        log::set_max_level(LevelFilter::Info);
    }

    log::info!("✅ File logger initialized at: {}", log_path.display());

    Ok(LOGGER.get().unwrap().tx.clone())
}