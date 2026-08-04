//! Canonical error code constants for the backend.
//!
//! These MUST match the `BackendErrorCode` enum in
//! `packages/contracts/src/index.ts`. Any change here requires a
//! corresponding change in the contracts package and an IPC version bump.

// ── Network / connectivity ────────────────────────────
pub const NETWORK_ERROR: &str = "NETWORK_ERROR";
pub const CONNECTION_FAILED: &str = "CONNECTION_FAILED";
pub const TIMEOUT: &str = "TIMEOUT";

// ── Ollama service ────────────────────────────────────
pub const OLLAMA_UNAVAILABLE: &str = "OLLAMA_UNAVAILABLE";
pub const OLLAMA_ERROR: &str = "OLLAMA_ERROR";
pub const NOT_OLLAMA: &str = "NOT_OLLAMA";
pub const MODEL_NOT_FOUND: &str = "MODEL_NOT_FOUND";
pub const HEALTH_CHECK_TIMEOUT: &str = "HEALTH_CHECK_TIMEOUT";
pub const HEALTH_CHECK_FAILED: &str = "HEALTH_CHECK_FAILED";

// ── Validation / input ────────────────────────────────
pub const INVALID_REQUEST: &str = "INVALID_REQUEST";
pub const INVALID_INPUT: &str = "INVALID_INPUT";
pub const INVALID_URL: &str = "INVALID_URL";
pub const INVALID_RESPONSE: &str = "INVALID_RESPONSE";
pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";

// ── Rate limiting / concurrency ───────────────────────
pub const RATE_LIMITED: &str = "RATE_LIMITED";
pub const DUPLICATE_REQUEST: &str = "DUPLICATE_REQUEST";

// ── Streaming ─────────────────────────────────────────
pub const STREAM_TIMEOUT: &str = "STREAM_TIMEOUT";
pub const STREAM_IDLE_TIMEOUT: &str = "STREAM_IDLE_TIMEOUT";

// ── File system ───────────────────────────────────────
pub const FILE_SYSTEM_ERROR: &str = "FILE_SYSTEM_ERROR";
pub const FILE_TOO_LARGE: &str = "FILE_TOO_LARGE";

// ── Parse / response ──────────────────────────────────
pub const PARSE_ERROR: &str = "PARSE_ERROR";
pub const DELETE_ERROR: &str = "DELETE_ERROR";

// ── Title generation ──────────────────────────────────
pub const EMPTY_TITLE: &str = "EMPTY_TITLE";
pub const REASONING_INSTEAD_OF_TITLE: &str = "REASONING_INSTEAD_OF_TITLE";

// ── RAG ───────────────────────────────────────────────
pub const RAG_CREATE_ERROR: &str = "RAG_CREATE_ERROR";
pub const RAG_DELETE_ERROR: &str = "RAG_DELETE_ERROR";
pub const RAG_UPDATE_ERROR: &str = "RAG_UPDATE_ERROR";
pub const RAG_NOT_FOUND: &str = "RAG_NOT_FOUND";
pub const RAG_FETCH_ERROR: &str = "RAG_FETCH_ERROR";
pub const RAG_LIST_ERROR: &str = "RAG_LIST_ERROR";
pub const RAG_SEARCH_ERROR: &str = "RAG_SEARCH_ERROR";
pub const RAG_STATS_ERROR: &str = "RAG_STATS_ERROR";
pub const RAG_VALIDATION_ERROR: &str = "RAG_VALIDATION_ERROR";
pub const RAG_ALREADY_INDEXING: &str = "RAG_ALREADY_INDEXING";
pub const RAG_INDEX_ERROR: &str = "RAG_INDEX_ERROR";

// ── Conversation ──────────────────────────────────────
pub const CONVERSATION_NOT_FOUND: &str = "CONVERSATION_NOT_FOUND";
pub const CONVERSATION_FETCH_ERROR: &str = "CONVERSATION_FETCH_ERROR";
pub const CONVERSATION_LIST_ERROR: &str = "CONVERSATION_LIST_ERROR";
pub const CONVERSATION_CREATE_ERROR: &str = "CONVERSATION_CREATE_ERROR";
pub const CONVERSATION_DELETE_ERROR: &str = "CONVERSATION_DELETE_ERROR";
pub const CONVERSATION_UPDATE_ERROR: &str = "CONVERSATION_UPDATE_ERROR";
pub const MESSAGE_APPEND_ERROR: &str = "MESSAGE_APPEND_ERROR";
pub const CONVERSATION_LOCK_ERROR: &str = "CONVERSATION_LOCK_ERROR";

// ── Dialog ────────────────────────────────────────────
pub const DIALOG_ERROR: &str = "DIALOG_ERROR";

// ── Context menu ──────────────────────────────────────
pub const CONTEXT_MENU_ERROR: &str = "CONTEXT_MENU_ERROR";

// ── System tray ───────────────────────────────────────
pub const TRAY_ERROR: &str = "TRAY_ERROR";

// ── Menu bar ──────────────────────────────────────────
pub const MENU_BAR_ERROR: &str = "MENU_BAR_ERROR";

// ── URL Opener ────────────────────────────────────────
pub const URL_BLOCKED: &str = "URL_BLOCKED";
pub const OPEN_URL_ERROR: &str = "OPEN_URL_ERROR";

// ── Export ────────────────────────────────────────────
pub const EXPORT_ERROR: &str = "EXPORT_ERROR";

// ── Migration ─────────────────────────────────────────
pub const MIGRATION_ERROR: &str = "MIGRATION_ERROR";

// ── Trace / logging ───────────────────────────────────
pub const INVALID_TRACE_ID: &str = "INVALID_TRACE_ID";
pub const INVALID_FEATURE: &str = "INVALID_FEATURE";
pub const INVALID_ACTION: &str = "INVALID_ACTION";
pub const SPAN_NOT_FOUND: &str = "SPAN_NOT_FOUND";

// ── Generic ───────────────────────────────────────────
pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
pub const ABORTED: &str = "ABORTED";
pub const UNKNOWN: &str = "UNKNOWN";

#[cfg(test)]
mod tests {
    use super::*;

    /// Ensures every constant produces a distinct value (no accidental
    /// duplicates). This is a cheap sanity check; the real contract
    /// alignment is validated in CI.
    #[test]
    fn all_codes_are_distinct() {
        let codes = [
            NETWORK_ERROR,
            CONNECTION_FAILED,
            TIMEOUT,
            OLLAMA_UNAVAILABLE,
            OLLAMA_ERROR,
            NOT_OLLAMA,
            MODEL_NOT_FOUND,
            HEALTH_CHECK_TIMEOUT,
            HEALTH_CHECK_FAILED,
            INVALID_REQUEST,
            INVALID_INPUT,
            INVALID_URL,
            INVALID_RESPONSE,
            RATE_LIMITED,
            DUPLICATE_REQUEST,
            STREAM_TIMEOUT,
            STREAM_IDLE_TIMEOUT,
            FILE_SYSTEM_ERROR,
            FILE_TOO_LARGE,
            PARSE_ERROR,
            DELETE_ERROR,
            EMPTY_TITLE,
            REASONING_INSTEAD_OF_TITLE,
            RAG_CREATE_ERROR,
            RAG_DELETE_ERROR,
            RAG_UPDATE_ERROR,
            RAG_NOT_FOUND,
            RAG_FETCH_ERROR,
            RAG_LIST_ERROR,
            RAG_SEARCH_ERROR,
            RAG_STATS_ERROR,
            RAG_VALIDATION_ERROR,
            RAG_ALREADY_INDEXING,
            RAG_INDEX_ERROR,
            VALIDATION_ERROR,
            CONVERSATION_NOT_FOUND,
            CONVERSATION_FETCH_ERROR,
            CONVERSATION_LIST_ERROR,
            CONVERSATION_CREATE_ERROR,
            CONVERSATION_DELETE_ERROR,
            CONVERSATION_UPDATE_ERROR,
            MESSAGE_APPEND_ERROR,
            CONVERSATION_LOCK_ERROR,
            INTERNAL_ERROR,
            ABORTED,
            UNKNOWN,
            CONTEXT_MENU_ERROR,
            TRAY_ERROR,
            MENU_BAR_ERROR,
            MIGRATION_ERROR,
            INVALID_TRACE_ID,
            INVALID_FEATURE,
            INVALID_ACTION,
            SPAN_NOT_FOUND,
        ];
        let mut seen = std::collections::HashSet::new();
        for &code in &codes {
            assert!(seen.insert(code), "duplicate error code: {}", code);
        }
        assert_eq!(seen.len(), codes.len());
    }
}
