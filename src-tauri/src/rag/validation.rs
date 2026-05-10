//! RAG-specific input validation for all RAG IPC commands.
//!
//! Constants are defined in [`crate::generated_validation`] (auto-generated from
//! `packages/contracts/src/validation-limits.ts`) and re-exported here for
//! backward compatibility.

use crate::payloads::{ApiResponse, BackendError};
use crate::validation::is_valid_model_name;

// Re-export RAG-specific constants from the generated module.
pub use crate::generated_validation::{
    MAX_FILE_CHUNKS_QUERY, MAX_FILE_PATH_LEN, MAX_IGNORE_PATTERNS, MAX_IGNORE_PATTERN_LEN,
    MAX_PROJECT_NAME_LEN, MAX_PROJECT_PATH_LEN, MAX_SEARCH_QUERY_LEN, MAX_THRESHOLD, MAX_TOP_K,
    MIN_THRESHOLD, MIN_TOP_K,
};

// ====================== VALIDATORS ======================

/// Validates the input for `cmd_rag_add_project`.
pub fn validate_add_project(
    name: &str,
    path: &str,
    embedding_model: &str,
    ignore_patterns: &[String],
) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_PROJECT_NAME_LEN {
        return Err(format!(
            "Project name must be 1-{} characters, got {}",
            MAX_PROJECT_NAME_LEN,
            name.len()
        ));
    }
    if path.is_empty() || path.len() > MAX_PROJECT_PATH_LEN {
        return Err(format!(
            "Project path must be 1-{} characters, got {}",
            MAX_PROJECT_PATH_LEN,
            path.len()
        ));
    }
    if !is_valid_model_name(embedding_model) {
        return Err(format!(
            "Invalid embedding model name: {:?}",
            embedding_model
        ));
    }
    if ignore_patterns.len() > MAX_IGNORE_PATTERNS {
        return Err(format!(
            "Too many ignore patterns (max {}, got {})",
            MAX_IGNORE_PATTERNS,
            ignore_patterns.len()
        ));
    }
    for (i, pattern) in ignore_patterns.iter().enumerate() {
        if pattern.len() > MAX_IGNORE_PATTERN_LEN {
            return Err(format!(
                "Ignore pattern {} exceeds {} bytes (got {})",
                i,
                MAX_IGNORE_PATTERN_LEN,
                pattern.len()
            ));
        }
    }
    Ok(())
}

/// Validates the input for `cmd_rag_search`.
pub fn validate_search(
    project_id: &str,
    query: &str,
    top_k: Option<usize>,
    threshold: Option<f32>,
) -> Result<(), String> {
    if project_id.is_empty() {
        return Err("Project ID must not be empty".to_string());
    }
    if query.is_empty() || query.len() > MAX_SEARCH_QUERY_LEN {
        return Err(format!(
            "Search query must be 1-{} bytes, got {}",
            MAX_SEARCH_QUERY_LEN,
            query.len()
        ));
    }
    if let Some(k) = top_k {
        if !(MIN_TOP_K..=MAX_TOP_K).contains(&k) {
            return Err(format!(
                "topK must be {}-{}, got {}",
                MIN_TOP_K, MAX_TOP_K, k
            ));
        }
    }
    if let Some(t) = threshold {
        if !(MIN_THRESHOLD..=MAX_THRESHOLD).contains(&t) {
            return Err(format!(
                "threshold must be {}-{}, got {}",
                MIN_THRESHOLD, MAX_THRESHOLD, t
            ));
        }
    }
    Ok(())
}

/// Validates a project ID string.
pub fn validate_project_id(project_id: &str) -> Result<(), String> {
    if project_id.is_empty() {
        return Err("Project ID must not be empty".to_string());
    }
    // UUID v4 format: 8-4-4-4-12 hex chars
    if !project_id
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("Invalid project ID format".to_string());
    }
    Ok(())
}

/// Validates a file path for chunk queries.
pub fn validate_file_path(file_path: &str) -> Result<(), String> {
    if file_path.is_empty() || file_path.len() > MAX_FILE_PATH_LEN {
        return Err(format!(
            "File path must be 1-{} characters, got {}",
            MAX_FILE_PATH_LEN,
            file_path.len()
        ));
    }
    // Reject absolute paths or path traversal
    if file_path.starts_with('/') || file_path.starts_with("..") {
        return Err("File path must be relative to the project root".to_string());
    }
    Ok(())
}

/// Builds a RAG validation error `ApiResponse`.
pub fn rag_validation_error<T>(message: impl Into<String>) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new("RAG_VALIDATION_ERROR", message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_add_project() {
        assert!(validate_add_project(
            "my-project",
            "/home/user/project",
            "nomic-embed-text-v2-moe",
            &[]
        )
        .is_ok());
    }

    #[test]
    fn invalid_add_project_empty_name() {
        assert!(validate_add_project("", "/path", "model", &[]).is_err());
    }

    #[test]
    fn invalid_add_project_name_too_long() {
        assert!(
            validate_add_project(&"x".repeat(MAX_PROJECT_NAME_LEN + 1), "/path", "model", &[])
                .is_err()
        );
    }

    #[test]
    fn invalid_add_project_empty_path() {
        assert!(validate_add_project("name", "", "model", &[]).is_err());
    }

    #[test]
    fn invalid_add_project_bad_model() {
        assert!(validate_add_project("name", "/path", "bad model!", &[]).is_err());
    }

    #[test]
    fn invalid_add_project_too_many_ignore_patterns() {
        let patterns: Vec<String> = (0..=MAX_IGNORE_PATTERNS)
            .map(|i| format!("pat{i}"))
            .collect();
        assert!(validate_add_project("name", "/path", "model", &patterns).is_err());
    }

    #[test]
    fn valid_search() {
        assert!(validate_search("proj-id", "how does X work?", Some(10), Some(0.5)).is_ok());
    }

    #[test]
    fn invalid_search_empty_query() {
        assert!(validate_search("proj-id", "", None, None).is_err());
    }

    #[test]
    fn invalid_search_top_k_out_of_range() {
        assert!(validate_search("proj-id", "query", Some(0), None).is_err());
        assert!(validate_search("proj-id", "query", Some(MAX_TOP_K + 1), None).is_err());
    }

    #[test]
    fn invalid_search_threshold_out_of_range() {
        assert!(validate_search("proj-id", "query", None, Some(-0.1)).is_err());
        assert!(validate_search("proj-id", "query", None, Some(1.5)).is_err());
    }

    #[test]
    fn valid_project_id() {
        assert!(validate_project_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn invalid_project_id_empty() {
        assert!(validate_project_id("").is_err());
    }

    #[test]
    fn invalid_project_id_chars() {
        assert!(validate_project_id("not-a-uuid!@#").is_err());
    }

    #[test]
    fn valid_file_path() {
        assert!(validate_file_path("src/main.rs").is_ok());
    }

    #[test]
    fn invalid_file_path_absolute() {
        assert!(validate_file_path("/etc/passwd").is_err());
    }

    #[test]
    fn invalid_file_path_traversal() {
        assert!(validate_file_path("../secret").is_err());
    }

    #[test]
    fn rag_validation_error_response() {
        let resp: ApiResponse<String> = rag_validation_error("bad input");
        assert!(!resp.success);
        assert!(resp.data.is_none());
        let err = resp.error.unwrap();
        assert_eq!(err.code, "RAG_VALIDATION_ERROR");
    }

    // --- generated RAG constants match expected values ---

    #[test]
    fn generated_rag_constants_sanity() {
        assert_eq!(MAX_PROJECT_NAME_LEN, 256);
        assert_eq!(MAX_PROJECT_PATH_LEN, 4096);
        assert_eq!(MAX_IGNORE_PATTERNS, 100);
        assert_eq!(MAX_IGNORE_PATTERN_LEN, 512);
        assert_eq!(MAX_SEARCH_QUERY_LEN, 10 * 1024);
        assert_eq!(MAX_TOP_K, 50);
        assert_eq!(MIN_TOP_K, 1);
        assert_eq!(MAX_THRESHOLD, 1.0);
        assert_eq!(MIN_THRESHOLD, 0.0);
        assert_eq!(MAX_FILE_CHUNKS_QUERY, 100);
        assert_eq!(MAX_FILE_PATH_LEN, 4096);
    }
}
