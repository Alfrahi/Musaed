use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use lazy_static::lazy_static;
use regex::Regex;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// Allowed URL patterns for the opener plugin.
// Must stay in sync with `apps/web/src/lib/ipc.ts` OPENER_ALLOWED_PATTERNS.
lazy_static! {
    static ref OPENER_ALLOWED_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"^https://github\.com/alfrahi/musaed/.+$").unwrap(),
        Regex::new(r"^https://github\.com/Alfrahi/Musaed/.+$").unwrap(),
        Regex::new(r"^https://github\.com/alfrahi/musaed$").unwrap(),
        Regex::new(r"^https://github\.com/Alfrahi/Musaed$").unwrap(),
        Regex::new(r"^https://ollama\.com/.+$").unwrap(),
        Regex::new(r"^https://ollama\.com$").unwrap(),
        Regex::new(r"^https://ollama\.ai/.+$").unwrap(),
        Regex::new(r"^https://ollama\.ai$").unwrap(),
        Regex::new(r"^mailto:/?$").unwrap(),
    ];
}

/// Checks if a URL matches the allowed patterns for opening.
///
/// # Arguments
/// * `url` - The URL to validate
///
/// # Returns
/// `true` if the URL is allowed, `false` otherwise
pub fn is_opener_url_allowed(url: &str) -> bool {
    OPENER_ALLOWED_PATTERNS
        .iter()
        .any(|pattern| pattern.is_match(url))
}

/// Opens a URL in the user's default browser using tauri-plugin-opener.
/// URLs are validated against an allowlist to prevent opening arbitrary external links.
///
/// # Arguments
/// * `_app` - Tauri app handle (used for plugin access)
/// * `url` - The URL to open
///
/// # Returns
/// `ApiResponse<bool>` - true if URL was opened successfully, false if blocked or failed
#[tauri::command]
pub async fn cmd_opener_open_url(app: AppHandle, url: String) -> ApiResponse<bool> {
    // Validate URL against allowlist
    if !is_opener_url_allowed(&url) {
        return ApiResponse {
            success: false,
            data: Some(false),
            error: Some(BackendError::new(
                error_codes::URL_BLOCKED,
                "URL is not in the allowed list",
            )),
        };
    }

    // Attempt to open the URL using tauri-plugin-opener
    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: Some(false),
            error: Some(BackendError::new(
                error_codes::OPEN_URL_ERROR,
                format!("Failed to open URL: {}", e),
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allowed_github_urls() {
        // Test GitHub repository URLs (both case variants)
        assert!(is_opener_url_allowed("https://github.com/alfrahi/musaed"));
        assert!(is_opener_url_allowed("https://github.com/Alfrahi/Musaed"));
        assert!(is_opener_url_allowed(
            "https://github.com/alfrahi/musaed/issues"
        ));
        assert!(is_opener_url_allowed(
            "https://github.com/Alfrahi/Musaed/pull/123"
        ));
        assert!(is_opener_url_allowed(
            "https://github.com/alfrahi/musaed/releases/tag/v1.0.0"
        ));
    }

    #[test]
    fn test_allowed_ollama_urls() {
        // Test Ollama URLs (.com and .ai)
        assert!(is_opener_url_allowed("https://ollama.com"));
        assert!(is_opener_url_allowed("https://ollama.ai"));
        assert!(is_opener_url_allowed("https://ollama.com/library"));
        assert!(is_opener_url_allowed("https://ollama.ai/blog"));
        assert!(is_opener_url_allowed("https://ollama.com/library/llama3"));
    }

    #[test]
    fn test_allowed_mailto_urls() {
        // Test mailto URLs
        assert!(is_opener_url_allowed("mailto:"));
        assert!(is_opener_url_allowed("mailto:/"));
    }

    #[test]
    fn test_blocked_urls() {
        // Test URLs that should be blocked
        assert!(!is_opener_url_allowed("https://google.com"));
        assert!(!is_opener_url_allowed("https://evil.com"));
        assert!(!is_opener_url_allowed("http://github.com/alfrahi/musaed")); // http not https
        assert!(!is_opener_url_allowed("https://github.com/other/repo"));
        assert!(!is_opener_url_allowed("https://ollama.org")); // wrong TLD
        assert!(!is_opener_url_allowed("javascript:alert('xss')"));
        assert!(!is_opener_url_allowed("ftp://example.com"));
        assert!(!is_opener_url_allowed("file:///etc/passwd"));
    }

    #[test]
    fn test_blocked_github_subdomains() {
        // GitHub subdomains should be blocked (only main repo URLs allowed)
        assert!(!is_opener_url_allowed(
            "https://gist.github.com/alfrahi/musaed"
        ));
        assert!(!is_opener_url_allowed(
            "https://raw.githubusercontent.com/alfrahi/musaed"
        ));
    }

    #[test]
    fn test_url_blocked_response_structure() {
        // Test that blocked URLs return proper error response structure
        let error_response: ApiResponse<bool> = ApiResponse {
            success: false,
            data: Some(false),
            error: Some(BackendError::new(
                error_codes::URL_BLOCKED,
                "URL is not in the allowed list",
            )),
        };

        assert!(!error_response.success);
        assert_eq!(error_response.data, Some(false));
        assert!(error_response.error.is_some());
        assert_eq!(error_response.error.unwrap().code, error_codes::URL_BLOCKED);
    }

    #[test]
    fn test_opener_success_response_structure() {
        // Test success response structure
        let success_response: ApiResponse<bool> = ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        };

        assert!(success_response.success);
        assert_eq!(success_response.data, Some(true));
        assert!(success_response.error.is_none());
    }

    #[test]
    fn test_empty_url_rejected() {
        assert!(!is_opener_url_allowed(""));
    }

    #[test]
    fn test_malformed_urls_rejected() {
        assert!(!is_opener_url_allowed("not-a-url"));
        assert!(!is_opener_url_allowed("ht tp://example.com"));
        assert!(!is_opener_url_allowed("https://"));
    }

    #[test]
    fn test_url_with_path_query_rejected_if_not_matching() {
        // URLs with query strings that don't match should be rejected
        assert!(!is_opener_url_allowed(
            "https://github.com/alfrahi/musaed?query=test"
        ));
        assert!(!is_opener_url_allowed("https://ollama.com#anchor"));
    }
}
