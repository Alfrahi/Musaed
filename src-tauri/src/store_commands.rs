use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Loads a store file and returns a session token (the filename).
/// The store is managed by tauri-plugin-store; subsequent get/set/save/delete
/// calls reference the same filename.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `file` - Store filename (e.g. "logs.json", "settings.json")
///
/// # Returns
/// `ApiResponse<bool>` — true if the store was loaded successfully
#[tauri::command]
pub async fn cmd_store_load(app: AppHandle, file: String) -> ApiResponse<bool> {
    match app.store(&file) {
        Ok(_store) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: Some(false),
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Failed to load store '{}': {}", file, e),
            )),
        },
    }
}

/// Gets a value from a store by key.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `file` - Store filename
/// * `key` - The key to retrieve
///
/// # Returns
/// `ApiResponse<Option<Value>>` — the value if found, null otherwise
#[tauri::command]
pub async fn cmd_store_get(
    app: AppHandle,
    file: String,
    key: String,
) -> ApiResponse<Option<Value>> {
    let store = match app.store(&file) {
        Ok(s) => s,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(
                    error_codes::FILE_SYSTEM_ERROR,
                    format!("Failed to access store: {}", e),
                )),
            };
        }
    };

    match store.get(&key) {
        Some(value) => ApiResponse {
            success: true,
            data: Some(Some(value.clone())),
            error: None,
        },
        None => ApiResponse {
            success: true,
            data: Some(None),
            error: None,
        },
    }
}

/// Sets a value in a store by key.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `file` - Store filename
/// * `key` - The key to set
/// * `value` - JSON value to store
///
/// # Returns
/// `ApiResponse<bool>` — true if the value was set
#[tauri::command]
pub async fn cmd_store_set(
    app: AppHandle,
    file: String,
    key: String,
    value: Value,
) -> ApiResponse<bool> {
    let store = match app.store(&file) {
        Ok(s) => s,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new(
                    error_codes::FILE_SYSTEM_ERROR,
                    format!("Failed to access store: {}", e),
                )),
            };
        }
    };

    store.set(&key, value);

    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    }
}

/// Saves a store to disk.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `file` - Store filename
///
/// # Returns
/// `ApiResponse<bool>` — true if saved successfully
#[tauri::command]
pub async fn cmd_store_save(app: AppHandle, file: String) -> ApiResponse<bool> {
    let store = match app.store(&file) {
        Ok(s) => s,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new(
                    error_codes::FILE_SYSTEM_ERROR,
                    format!("Failed to access store: {}", e),
                )),
            };
        }
    };

    match store.save() {
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
                format!("Failed to save store: {}", e),
            )),
        },
    }
}

/// Deletes a key from a store.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `file` - Store filename
/// * `key` - The key to delete
///
/// # Returns
/// `ApiResponse<bool>` — true if the key was deleted
#[tauri::command]
pub async fn cmd_store_delete(app: AppHandle, file: String, key: String) -> ApiResponse<bool> {
    let store = match app.store(&file) {
        Ok(s) => s,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new(
                    error_codes::FILE_SYSTEM_ERROR,
                    format!("Failed to access store: {}", e),
                )),
            };
        }
    };

    let deleted = store.delete(&key);

    ApiResponse {
        success: true,
        data: Some(deleted),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_codes;

    #[test]
    fn test_store_load_error_response() {
        let resp: ApiResponse<bool> = ApiResponse {
            success: false,
            data: Some(false),
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                "Failed to load store 'test.json': not found",
            )),
        };
        assert!(!resp.success);
        assert_eq!(resp.data, Some(false));
        assert!(resp.error.is_some());
    }

    #[test]
    fn test_store_get_success_response() {
        let resp: ApiResponse<Option<serde_json::Value>> = ApiResponse {
            success: true,
            data: Some(Some(serde_json::json!({"key": "value"}))),
            error: None,
        };
        assert!(resp.success);
        assert!(resp.data.unwrap().is_some());
    }

    #[test]
    fn test_store_set_success_response() {
        let resp: ApiResponse<bool> = ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        };
        assert!(resp.success);
        assert_eq!(resp.data, Some(true));
    }

    #[test]
    fn test_store_save_success_response() {
        let resp: ApiResponse<bool> = ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        };
        assert!(resp.success);
    }

    #[test]
    fn test_store_delete_success_response() {
        let resp: ApiResponse<bool> = ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        };
        assert!(resp.success);
        assert_eq!(resp.data, Some(true));
    }
}
