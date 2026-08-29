//! IPC commands for migration operations
//!
//! Provides Tauri commands for:
//! - Running migrations
//! - Rolling back migrations
//! - Checking migration status
//! - Listing available migrations

use crate::payloads::ApiResponse;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Request to run migrations
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMigrationsRequest {
    /// Target database (conversations)
    pub target: String,
    /// Optional target version (None = latest)
    pub target_version: Option<u32>,
    /// Whether to allow rollback on failure
    #[serde(default = "default_true")]
    pub allow_rollback: bool,
}

fn default_true() -> bool {
    true
}

/// Response from migration operations
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMigrationsResponse {
    pub success: bool,
    pub from_version: u32,
    pub to_version: u32,
    pub applied_migrations: Vec<u32>,
    pub error: Option<MigrationErrorDetail>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationErrorDetail {
    pub code: String,
    pub message: String,
}

/// Migration status information
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    pub target: String,
    pub current_version: u32,
    pub latest_version: u32,
    pub needs_migration: bool,
}

/// List available migrations for a target
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationInfo {
    pub version: u32,
    pub description: String,
    pub is_rollbackable: bool,
}

/// Run migrations for a target database
#[tauri::command]
pub async fn cmd_run_migrations(
    conversation_store: State<'_, Arc<Mutex<Connection>>>,
    target: String,
    target_version: Option<u32>,
    allow_rollback: bool,
) -> Result<ApiResponse<RunMigrationsResponse>, String> {
    let request = RunMigrationsRequest {
        target,
        target_version,
        allow_rollback,
    };
    Ok(crate::migrations::service::run(conversation_store.inner().clone(), request).await)
}

/// Rollback to a previous version
#[tauri::command]
pub async fn cmd_rollback_migrations(
    conversation_store: State<'_, Arc<Mutex<Connection>>>,
    target: String,
    to_version: u32,
) -> Result<ApiResponse<RunMigrationsResponse>, String> {
    Ok(
        crate::migrations::service::rollback(
            conversation_store.inner().clone(),
            target,
            to_version,
        )
        .await,
    )
}

/// Get migration status for a target database
#[tauri::command]
pub async fn cmd_get_migration_status(
    conversation_store: State<'_, Arc<Mutex<Connection>>>,
    target: String,
) -> Result<ApiResponse<MigrationStatus>, String> {
    Ok(crate::migrations::service::status(conversation_store.inner().clone(), target).await)
}

/// List available migrations for a target
#[tauri::command]
pub fn cmd_list_migrations(target: String) -> ApiResponse<Vec<MigrationInfo>> {
    crate::migrations::service::list(target)
}
