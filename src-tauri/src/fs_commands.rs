use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use std::path::Path;

/// Reads a text file from the filesystem and returns its contents as a string.
///
/// # Arguments
/// * `path` - Absolute path to the file
///
/// # Returns
/// `ApiResponse<String>` — the file contents, or an error
#[tauri::command]
pub async fn cmd_fs_read_text_file(path: String) -> ApiResponse<String> {
    let file_path = Path::new(&path);

    // Security: validate the path exists and is a file
    if !file_path.exists() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("File not found: {}", path),
            )),
        };
    }

    if !file_path.is_file() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Path is not a file: {}", path),
            )),
        };
    }

    match std::fs::read_to_string(&path) {
        Ok(content) => ApiResponse {
            success: true,
            data: Some(content),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Failed to read file '{}': {}", path, e),
            )),
        },
    }
}

/// Reads a binary file from the filesystem and returns its contents as a
/// base64-encoded string.
///
/// # Arguments
/// * `path` - Absolute path to the file
///
/// # Returns
/// `ApiResponse<String>` — base64-encoded file contents, or an error
#[tauri::command]
pub async fn cmd_fs_read_file(path: String) -> ApiResponse<String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("File not found: {}", path),
            )),
        };
    }

    if !file_path.is_file() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Path is not a file: {}", path),
            )),
        };
    }

    match std::fs::read(&path) {
        Ok(bytes) => {
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            ApiResponse {
                success: true,
                data: Some(encoded),
                error: None,
            }
        }
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Failed to read file '{}': {}", path, e),
            )),
        },
    }
}

/// Writes text content to a file on the filesystem.
///
/// #1
/// * `path` - Absolute path to the file
/// * `content` - Text content to write
///
/// # Returns
/// `ApiResponse<bool>` — true if the write succeeded
#[tauri::command]
pub async fn cmd_fs_write_text_file(path: String, content: String) -> ApiResponse<bool> {
    let file_path = Path::new(&path);

    // Create parent directories if they don't exist
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return ApiResponse {
                    success: false,
                    data: Some(false),
                    error: Some(BackendError::new(
                        error_codes::FILE_SYSTEM_ERROR,
                        format!("Failed to create parent directories: {}", e),
                    )),
                };
            }
        }
    }

    match std::fs::write(&path, &content) {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: Some(false),
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Failed to write file '{}': {}", path, e),
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_codes;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_read_text_file_success() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "hello world").unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let resp = rt.block_on(cmd_fs_read_text_file(path));
        assert!(resp.success);
        assert_eq!(resp.data.unwrap(), "hello world");
    }

    #[test]
    fn test_read_text_file_not_found() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let resp = rt.block_on(cmd_fs_read_text_file(
            "/nonexistent/path/file.txt".to_string(),
        ));
        assert!(!resp.success);
        assert!(resp.error.is_some());
    }

    #[test]
    fn test_read_text_file_is_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let resp = rt.block_on(cmd_fs_read_text_file(path));
        assert!(!resp.success);
        assert!(resp.error.is_some());
    }

    #[test]
    fn test_write_text_file_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("test_output.txt")
            .to_string_lossy()
            .to_string();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let resp = rt.block_on(cmd_fs_write_text_file(
            path.clone(),
            "output content".to_string(),
        ));
        assert!(resp.success);
        assert_eq!(resp.data, Some(true));

        // Verify the file was written
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "output content");
    }

    #[test]
    fn test_write_text_file_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("nested")
            .join("deep")
            .join("file.txt")
            .to_string_lossy()
            .to_string();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let resp = rt.block_on(cmd_fs_write_text_file(path.clone(), "nested".to_string()));
        assert!(resp.success);

        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "nested");
    }

    #[test]
    fn test_read_file_base64() {
        let mut tmp = NamedTempFile::new().unwrap();
        let data: Vec<u8> = vec![0, 1, 2, 3, 255];
        tmp.write_all(&data).unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let resp = rt.block_on(cmd_fs_read_file(path));
        assert!(resp.success);

        use base64::Engine;
        let expected = base64::engine::general_purpose::STANDARD.encode(&data);
        assert_eq!(resp.data.unwrap(), expected);
    }

    #[test]
    fn test_fs_error_response_structure() {
        let resp: ApiResponse<String> = ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                "test error",
            )),
        };
        assert!(!resp.success);
        assert!(resp.data.is_none());
        assert_eq!(resp.error.unwrap().code, error_codes::FILE_SYSTEM_ERROR);
    }
}
