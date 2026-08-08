//! Typed error enum for the RAG domain.
//!
//! Replaces ad-hoc `String` errors with a `thiserror::Error` enum so that
//! error classification (retryable vs permanent) is done by pattern matching
//! on typed variants rather than fragile substring matching.

use thiserror::Error;

/// A specialized `Result` type for all RAG domain operations.
pub type RagResult<T> = Result<T, RagError>;

/// Categorises an error as **transient** (worth retrying) or **permanent**.
///
/// This replaces the old `is_transient_index_error` substring-matching
/// function. Callers match on the variant directly — no string inspection
/// required.
pub fn is_transient(err: &RagError) -> bool {
    match err {
        // Permanent — never retry
        RagError::Cancelled(_)
        | RagError::NotFound(_)
        | RagError::InvalidInput(_)
        | RagError::Config(_)
        | RagError::VecDisabled(_) => false,

        // Transient — retry is safe
        RagError::Database(_)
        | RagError::EmbedFailed(_)
        | RagError::Http(_)
        | RagError::Io(_)
        | RagError::Json(_) => true,
    }
}

/// All error variants that can arise in the RAG domain.
#[derive(Debug, Error)]
pub enum RagError {
    /// SQLite database error (query failure, transaction rollback, etc.).
    ///
    /// Transient: SQLite `SQLITE_BUSY` / lock contention can resolve on retry.
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    /// Embedding generation failed (Ollama request failure, bad status,
    /// parse error, or no embedding returned).
    ///
    /// Transient: Ollama timeouts or transient server errors can recover.
    #[error("Embedding failed: {0}")]
    EmbedFailed(String),

    /// A referenced entity was not found (project, file, chunk).
    ///
    /// Permanent: a missing project will not appear by retrying.
    #[error("Not found: {0}")]
    NotFound(String),

    /// Indexing was cancelled via the cancellation token.
    ///
    /// Permanent: user-initiated cancellation should not be retried.
    #[error("Indexing cancelled: {0}")]
    Cancelled(String),

    /// The sqlite-vec extension is not loaded — vector operations are
    /// unavailable.
    ///
    /// Permanent: the extension failed to load at startup; retrying will
    /// not fix it until the process is restarted.
    #[error("RAG features are disabled: {0}")]
    VecDisabled(String),

    /// An I/O error occurred reading files from disk.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// An HTTP transport error occurred talking to Ollama.
    #[error("HTTP error: {0}")]
    Http(String),

    /// JSON serialization or deserialization failed.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Input validation or configuration error (invalid project ID, bad
    /// path, invalid embedding model name, etc.).
    ///
    /// Permanent: the caller must fix the input before retrying.
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    /// Configuration or environment error (path does not exist, not a
    /// directory, path traversal blocked, etc.).
    ///
    /// Permanent: configuration must be corrected before retrying.
    #[error("Configuration error: {0}")]
    Config(String),
}

impl RagError {
    /// Returns `true` if this error is transient (worth retrying).
    pub fn is_transient(&self) -> bool {
        is_transient(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_classification() {
        // Permanent
        let err = RagError::Cancelled("user".to_string());
        assert!(!err.is_transient());

        let err = RagError::NotFound("project".to_string());
        assert!(!err.is_transient());

        let err = RagError::InvalidInput("bad id".to_string());
        assert!(!err.is_transient());

        let err = RagError::Config("bad path".to_string());
        assert!(!err.is_transient());

        let err = RagError::VecDisabled("ext not loaded".to_string());
        assert!(!err.is_transient());

        // Transient
        let err = RagError::EmbedFailed("timeout".to_string());
        assert!(err.is_transient());

        let err = RagError::Http("connection refused".to_string());
        assert!(err.is_transient());

        let err = RagError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"));
        assert!(err.is_transient());

        // rusqlite::Error → Database variant via #[from]
        let err = RagError::from(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        ));
        assert!(err.is_transient());
    }

    #[test]
    fn display_messages_are_human_readable() {
        assert_eq!(
            RagError::NotFound("project abc".to_string()).to_string(),
            "Not found: project abc"
        );
        assert_eq!(
            RagError::Cancelled("by user".to_string()).to_string(),
            "Indexing cancelled: by user"
        );
        assert_eq!(
            RagError::VecDisabled("sqlite-vec not loaded".to_string()).to_string(),
            "RAG features are disabled: sqlite-vec not loaded"
        );
    }
}
