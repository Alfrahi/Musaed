//! Lightweight in-process performance metrics (MVP).
//!
//! Records latencies at key IPC choke points and exposes a snapshot command
//! the frontend can poll. `cmd_metrics_snapshot` returns stats and clears the
//! recorded samples, giving a rolling window per snapshot interval.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use serde::Serialize;

use crate::payloads::ApiResponse;

pub struct Metrics {
    pub chat_latency_ms: Mutex<Vec<u64>>,
    pub search_latency_ms: Mutex<Vec<u64>>,
    pub rag_index_duration_ms: Mutex<Vec<u64>>,
    /// request_id → chat start time; consumed on first token or error.
    chat_starts: Mutex<HashMap<String, Instant>>,
}

static METRICS: OnceLock<Metrics> = OnceLock::new();

pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(|| Metrics {
        chat_latency_ms: Mutex::new(Vec::new()),
        search_latency_ms: Mutex::new(Vec::new()),
        rag_index_duration_ms: Mutex::new(Vec::new()),
        chat_starts: Mutex::new(HashMap::new()),
    })
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // Poisoning only happens after a panic while holding the guard; recover
    // the data instead of cascading panics across unrelated commands.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn record_search(elapsed_ms: u64) {
    lock(&metrics().search_latency_ms).push(elapsed_ms);
}

pub fn record_rag_index(elapsed_ms: u64) {
    lock(&metrics().rag_index_duration_ms).push(elapsed_ms);
}

/// Registers the start of a chat request; consumed by `chat_first_token`.
pub fn begin_chat(request_id: &str) {
    lock(&metrics().chat_starts).insert(request_id.to_string(), Instant::now());
}

/// Records time-to-first-token for a chat request. No-op if the start was
/// never registered or was already consumed.
pub fn chat_first_token(request_id: &str) {
    let entry = lock(&metrics().chat_starts).remove(request_id);
    if let Some(start) = entry {
        lock(&metrics().chat_latency_ms).push(start.elapsed().as_millis() as u64);
    }
}

/// Drops a pending chat start that will never see a first token
/// (stream error before any token, abort mid-handshake).
pub fn abandon_chat(request_id: &str) {
    lock(&metrics().chat_starts).remove(request_id);
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetricStats {
    pub count: usize,
    pub mean_ms: f64,
    pub p95_ms: u64,
    pub p99_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub chat_latency: MetricStats,
    pub search_latency: MetricStats,
    pub rag_index_duration: MetricStats,
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[idx.saturating_sub(1).min(sorted.len() - 1)]
}

fn stats(mut samples: Vec<u64>) -> MetricStats {
    if samples.is_empty() {
        return MetricStats {
            count: 0,
            mean_ms: 0.0,
            p95_ms: 0,
            p99_ms: 0,
        };
    }
    samples.sort_unstable();
    let mean_ms = samples.iter().sum::<u64>() as f64 / samples.len() as f64;
    MetricStats {
        count: samples.len(),
        mean_ms,
        p95_ms: percentile(&samples, 95.0),
        p99_ms: percentile(&samples, 99.0),
    }
}

fn drain(m: &Mutex<Vec<u64>>) -> Vec<u64> {
    std::mem::take(&mut *lock(m))
}

/// Snapshots current samples and clears them (rolling window per call).
#[tauri::command]
pub fn cmd_metrics_snapshot() -> ApiResponse<MetricsSnapshot> {
    let m = metrics();
    ApiResponse {
        success: true,
        data: Some(MetricsSnapshot {
            chat_latency: stats(drain(&m.chat_latency_ms)),
            search_latency: stats(drain(&m.search_latency_ms)),
            rag_index_duration: stats(drain(&m.rag_index_duration_ms)),
        }),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_empty_returns_zeroes() {
        let s = stats(vec![]);
        assert_eq!(s.count, 0);
        assert_eq!(s.mean_ms, 0.0);
        assert_eq!(s.p95_ms, 0);
        assert_eq!(s.p99_ms, 0);
    }

    #[test]
    fn stats_single_sample() {
        let s = stats(vec![42]);
        assert_eq!(s.count, 1);
        assert_eq!(s.mean_ms, 42.0);
        assert_eq!(s.p95_ms, 42);
        assert_eq!(s.p99_ms, 42);
    }

    #[test]
    fn stats_sorts_and_picks_percentile_indices() {
        let samples: Vec<u64> = (1..=100).collect();
        let s = stats(samples);
        assert_eq!(s.count, 100);
        assert_eq!(s.mean_ms, 50.5);
        assert_eq!(s.p95_ms, 95);
        assert_eq!(s.p99_ms, 99);
    }

    #[test]
    fn stats_is_input_order_independent() {
        let s = stats(vec![30, 10, 20]);
        assert_eq!(s.mean_ms, 20.0);
    }

    #[test]
    fn percentile_handles_tiny_vectors() {
        assert_eq!(percentile(&[7], 95.0), 7);
        assert_eq!(percentile(&[7], 99.0), 7);
        assert_eq!(percentile(&[1, 2], 95.0), 2);
    }
}
