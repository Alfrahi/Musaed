//! Key-value storage domain service (STANDARDS §6).
//!
//! Owns the validation and error-mapping shared by every `cmd_store_*`
//! command. The commands in [`super::commands`] resolve the plugin store
//! handle and wrap the synchronous I/O in `spawn_blocking`; this module keeps
//! the filename/key/value rules and the `ApiResponse` error shapes in one
//! place so they are unit-testable without a Tauri runtime.

use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use crate::validation::{
    validate_store_filename, validate_store_key, validate_store_value, validation_error,
};
use serde_json::Value;

pub(crate) fn store_failure<T>(
    action: &str,
    file: &str,
    err: impl std::fmt::Display,
) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(
            error_codes::FILE_SYSTEM_ERROR,
            format!("Failed to {} store '{}': {}", action, file, err),
        )),
    }
}

/// Validates the shared `file` argument; returns an Err-shaped response when
/// the filename is rejected (path separators, `..`, control chars, empty, or
/// over the length cap).
pub(crate) fn check_file(file: &str) -> Option<ApiResponse<bool>> {
    validate_store_filename(file)
        .err()
        .map(|msg| validation_error(error_codes::INVALID_INPUT, format!("store file: {}", msg)))
}

/// Same as [`check_file`] but for commands returning `ApiResponse<Option<_>>`.
pub(crate) fn check_file_opt(file: &str) -> Option<ApiResponse<Option<Value>>> {
    validate_store_filename(file)
        .err()
        .map(|msg| validation_error(error_codes::INVALID_INPUT, format!("store file: {}", msg)))
}

/// Validates a store key; returns an Err-shaped response when rejected.
pub(crate) fn invalid_key<T>(key: &str) -> Option<ApiResponse<T>> {
    validate_store_key(key)
        .err()
        .map(|msg| validation_error(error_codes::INVALID_INPUT, format!("store key: {}", msg)))
}

/// Validates a store value (size cap); returns an Err-shaped response when
/// the serialized value exceeds the bound.
pub(crate) fn invalid_value<T>(value: &Value) -> Option<ApiResponse<T>> {
    validate_store_value(value)
        .err()
        .map(|msg| validation_error(error_codes::INVALID_INPUT, format!("store value: {}", msg)))
}
