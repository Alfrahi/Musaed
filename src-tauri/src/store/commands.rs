//! Tauri command adapters for the key-value store domain (`cmd_store_*`).
//!
//! Thin adapters only (STANDARDS §6): resolve the plugin store handle and
//! wrap the synchronous store I/O in `spawn_blocking`; validation and error
//! mapping live in [`super::service`].

use super::service::{check_file, check_file_opt, invalid_key, invalid_value, store_failure};
use crate::payloads::ApiResponse;
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Loads a store file and returns a session token (the filename).
#[tauri::command]
pub async fn cmd_store_load(app: AppHandle, file: String) -> ApiResponse<bool> {
    if let Some(err) = check_file(&file) {
        return err;
    }
    match tokio::task::spawn_blocking(move || {
        app.store(&file).map(|_| ()).map_err(|e| e.to_string())
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
    if let Some(err) = check_file_opt(&file) {
        return err;
    }
    if let Some(err) = invalid_key(&key) {
        return err;
    }
    match tokio::task::spawn_blocking(move || -> Result<Option<Value>, String> {
        let store = app.store(&file).map_err(|e| e.to_string())?;
        Ok(store.get(&key))
    })
    .await
    {
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
    if let Some(err) = invalid_key(&key) {
        return err;
    }
    if let Some(err) = invalid_value(&value) {
        return err;
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
    if let Some(err) = invalid_key(&key) {
        return err;
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
