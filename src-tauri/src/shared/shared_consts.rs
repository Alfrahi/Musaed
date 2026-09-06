//! Shared constants: concurrency limits, timeouts, cache bounds, event names.

pub const MAX_TOTAL_IMAGE_SIZE_BYTES: usize = 10 * 1024 * 1024;
pub const PULL_PROGRESS_THROTTLE_MS: u64 = 400;
pub const MAX_CONCURRENT_CHATS: usize = 8;
/// Maximum number of in-flight requests to Ollama across *all* command types
/// (health checks, model discovery, chat, pull, etc.).
pub const MAX_CONCURRENT_REQUESTS: usize = 16;
/// Timeout for fast discovery / health-check requests (seconds).
pub const FAST_TIMEOUT_SECS: u64 = 10;
/// Timeout for the shared general-purpose client (seconds).
pub const DEFAULT_TIMEOUT_SECS: u64 = 120;
pub const STREAM_IDLE_TIMEOUT_SECS: u64 = 300;
pub const STREAM_ABSOLUTE_TIMEOUT_SECS: u64 = 900;
pub const PULL_ABSOLUTE_TIMEOUT_SECS: u64 = 3600;
pub const INITIAL_REQUEST_TIMEOUT_SECS: u64 = 300;
/// Maximum age of a request-cache entry before it is considered stale and evicted.
/// Set slightly above `STREAM_ABSOLUTE_TIMEOUT_SECS` so legitimate in-flight streams
/// are never evicted prematurely.
pub const REQUEST_CACHE_TTL_SECS: u64 = STREAM_ABSOLUTE_TIMEOUT_SECS + 60;
/// How often the background eviction task sweeps `REQUEST_CACHE` (seconds).
pub const REQUEST_CACHE_EVICTION_INTERVAL_SECS: u64 = 120;
/// Hard upper bound on the number of entries in [`REQUEST_CACHE`].
/// Intentionally generous (4× the global concurrency limit) to never be hit
/// during normal operation, but prevents unbounded growth if cleanup paths leak.
pub const MAX_REQUEST_CACHE_SIZE: usize = MAX_CONCURRENT_REQUESTS * 4;

pub const EVENT_OLLAMA_TOKEN: &str = "ollama-token";
pub const EVENT_OLLAMA_ERROR: &str = "ollama-error";
pub const EVENT_PULL_PROGRESS: &str = "pull-progress";
pub const EVENT_PULL_ERROR: &str = "pull-error";

pub const EVENT_RAG_INDEX_PROGRESS: &str = "rag-index-progress";
pub const EVENT_RAG_INDEX_COMPLETE: &str = "rag-index-complete";
pub const EVENT_RAG_INDEX_ERROR: &str = "rag-index-error";

pub const EVENT_MENU_ACTION: &str = "menu-action";
