use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use crate::validation::{
    validate_store_filename, validate_store_key, validate_store_value, validation_error,
};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

fn store_failure<T>(action: &str, file: &str, err: impl std::fmt::Display) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(
            error_codes::FILE_SYSTEM_ERROR,
            format!("Failed to {} store '{}': {}", action, file, err),
        )),
    }
}

/// Validates the shared `file` argument of all store commands.
fn check_file(file: &str) -> Option<ApiResponse<bool>> {
    validate_store_filename(file)
        .err()
        .map(|msg| validation_error(error_codes::INVALID_INPUT, format!("store file: {}", msg)))
}

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
    if let Some(err) = check_file(&file) {
        return err;
    }
    match tokio::task::spawn_blocking(move || {
        app.store(&file).map(|_| ()).map_err(|e| e.to_string()) // registers with the plugin
    })
    .await
    {
        Ok(Ok(())) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Ok(Err(e)) => store_failure("load", "", e),
        Err(join_err) => store_failure("spawn blocking task for", "store", join_err),
    }
}

/// Gets a value from a store by key.
#[tauri::command]
pub async fn cmd_store_get(
    app: AppHandle,
    file: String,
    key: String,
) -> ApiResponse<Option<Value>> {
    if let Some(err) = check_file(&file) {
        return ApiResponse {
            success: false,
            data: None,
            error: err.error,
        };
    }
    if let Err(msg) = validate_store_key(&key) {
        return validation_error(error_codes::INVALID_INPUT, format!("store key: {}", msg));
    }
    let res = tokio::task::spawn_blocking(move || -> Result<Option<Value>, String> {
        let store = match app.store(&file) {
            Ok(s) => s,
            Err(e) => return Err(e.to_string()),
        };
        Ok(store.get(&key))
    })
    .await;
    match res {
        Ok(Ok(value)) => ApiResponse {
            success: true,
            data: Some(value),
            error: None,
        },
        Ok(Err(e)) => store_failure("access", "", e),
        Err(join_err) => store_failure("spawn blocking task for", "store", join_err),
    }
}

/// Sets a value in a store by key.
#[tauri::command]
pub async fn cmd_store_set(
    app: AppHandle,
    file: String,
    key: String,
    value: Value,
) -> ApiResponse<bool> {
    if let Some(err) = check_file(&file) {
        return err;
    }
    if let Err(msg) = validate_store_key(&key) {
        return validation_error(error_codes::INVALID_INPUT, format!("store key: {}", msg));
    }
    if let Err(msg) = validate_store_value(&value) {
        return validation_error(error_codes::INVALID_INPUT, format!("store value: {}", msg));
    }
    match tokio::task::spawn_blocking(move || -> Result<(), String> {
        let store = app.store(&file).map_err(|e| e.to_string())?;
        store.set(&key, value);
        Ok(())
    })
    .await
    {
        Ok(Ok(())) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Ok(Err(e)) => store_failure("access", "", e),
        Err(join_err) => store_failure("spawn blocking task for", "store", join_err),
    }
}

/// Saves a store to disk.
#[tauri::command]
pub async fn cmd_store_save(app: AppHandle, file: String) -> ApiResponse<bool> {
    if let Some(err) = check_file(&file) {
        return err;
    }
    match tokio::task::spawn_blocking(move || -> Result<(), String> {
        let store = app.store(&file).map_err(|e| e.to_string())?;
        store.save().map_err(|e| e.to_string())
    })
    .await
    {
        Ok(Ok(())) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Ok(Err(e)) => store_failure("save", "", e),
        Err(join_err) => store_failure("spawn blocking task for", "store", join_err),
    }
}

/// Deletes a key from a store.
#[tauri::command]
pub async fn cmd_store_delete(app: AppHandle, file: String, key: String) -> ApiResponse<bool> {
    if let Some(err) = check_file(&file) {
        return err;
    }
    if let Err(msg) = validate_store_key(&key) {
        return validation_error(error_codes::INVALID_INPUT, format!("store key: {}", msg));
    }
    match tokio::task::spawn_blocking(move || -> Result<bool, String> {
        let store = app.store(&file).map_err(|e| e.to_string())?;
        Ok(store.delete(&key))
    })
    .await
    {
        Ok(Ok(deleted)) => ApiResponse {
            success: true,
            data: Some(deleted),
            error: None,
        },
        Ok(Err(e)) => store_failure("access", "", e),
        Err(join_err) => store_failure("spawn blocking task for", "store", join_err),
    }
}
