//! IPC commands for migration operations
//!
//! Provides Tauri commands for:
//! - Running migrations
//! - Rolling back migrations
//! - Checking migration status
//! - Listing available migrations

use crate::migrations::{
    get_latest_version, list_migrations, rollback_to_version, run_migrations, version_tracker,
    MigrationError, MigrationTarget,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Request to run migrations
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMigrationsRequest {
    /// Target database (conversations or rag)
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

impl From<MigrationError> for MigrationErrorDetail {
    fn from(err: MigrationError) -> Self {
        let (code, message) = match &err {
            MigrationError::Database(e) => ("DATABASE_ERROR".to_string(), e.to_string()),
            MigrationError::MigrationFailed {
                target,
                from,
                to,
                message,
            } => (
                "MIGRATION_FAILED".to_string(),
                format!("{} v{}→v{}: {}", target, from, to, message),
            ),
            MigrationError::RollbackFailed {
                target,
                from,
                to,
                message,
            } => (
                "ROLLBACK_FAILED".to_string(),
                format!("{} v{}→v{}: {}", target, from, to, message),
            ),
            MigrationError::MissingMigration { target, version } => (
                "MISSING_MIGRATION".to_string(),
                format!("No migration found for {} at version {}", target, version),
            ),
            MigrationError::InvalidVersionSequence { from, to } => (
                "INVALID_VERSION_SEQUENCE".to_string(),
                format!("Cannot migrate from v{} to v{}", from, to),
            ),
            MigrationError::NotRollbackable { target, version } => (
                "NOT_ROLLBACKABLE".to_string(),
                format!("Migration {} v{} is not rollbackable", target, version),
            ),
            MigrationError::ValidationError(msg) => ("VALIDATION_ERROR".to_string(), msg.clone()),
        };

        Self { code, message }
    }
}

/// Migration status information
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatusResponse {
    pub target: String,
    pub current_version: u32,
    pub latest_version: u32,
    pub needs_migration: bool,
}

/// Rollback plan response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPlanResponse {
    pub target: String,
    pub from_version: u32,
    pub to_version: u32,
    pub migrations_to_rollback: Vec<MigrationToRollbackResponse>,
    pub is_safe: bool,
    pub warnings: Vec<String>,
    pub estimated_data_loss: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationToRollbackResponse {
    pub version: u32,
    pub description: String,
    pub is_rollbackable: bool,
    pub has_data_loss: bool,
}

/// Run migrations for a target database
#[tauri::command]
pub async fn cmd_run_migrations(
    conversation_store: State<'_, Arc<Mutex<Connection>>>,
    rag_store: State<'_, Arc<Mutex<Connection>>>,
    request: RunMigrationsRequest,
) -> Result<RunMigrationsResponse, String> {
    let target = parse_target(&request.target)?;

    let store = match target {
        MigrationTarget::Conversations => conversation_store.inner().clone(),
        MigrationTarget::Rag => rag_store.inner().clone(),
    };

    let result = run_migrations(store, target, request.target_version)
        .await
        .map_err(|e| e.to_string())?;

    Ok(RunMigrationsResponse {
        success: result.success,
        from_version: result.from_version,
        to_version: result.to_version,
        applied_migrations: result.applied_migrations,
        error: result.error.map(|e| MigrationErrorDetail {
            code: "UNKNOWN".to_string(),
            message: e,
        }),
    })
}

/// Rollback to a previous version
#[tauri::command]
pub async fn cmd_rollback_migrations(
    conversation_store: State<'_, Arc<Mutex<Connection>>>,
    rag_store: State<'_, Arc<Mutex<Connection>>>,
    target: String,
    to_version: u32,
) -> Result<RunMigrationsResponse, String> {
    let target = parse_target(&target)?;

    let store = match target {
        MigrationTarget::Conversations => conversation_store.inner().clone(),
        MigrationTarget::Rag => rag_store.inner().clone(),
    };

    let result = rollback_to_version(store, target, to_version)
        .await
        .map_err(|e| e.to_string())?;

    Ok(RunMigrationsResponse {
        success: result.success,
        from_version: result.from_version,
        to_version: result.to_version,
        applied_migrations: result.applied_migrations,
        error: result.error.map(|e| MigrationErrorDetail {
            code: "UNKNOWN".to_string(),
            message: e,
        }),
    })
}

/// Get migration status for a target database
#[tauri::command]
pub async fn cmd_get_migration_status(
    conversation_store: State<'_, Arc<Mutex<Connection>>>,
    rag_store: State<'_, Arc<Mutex<Connection>>>,
    target: String,
) -> Result<MigrationStatusResponse, String> {
    let target = parse_target(&target)?;

    let store = match target {
        MigrationTarget::Conversations => conversation_store.inner().clone(),
        MigrationTarget::Rag => rag_store.inner().clone(),
    };

    let conn_guard = store.lock().await;
    let current_version =
        version_tracker::get_current_version(&conn_guard, target).map_err(|e| e.to_string())?;

    let latest_version = get_latest_version(target);

    Ok(MigrationStatusResponse {
        target: target.as_str().to_string(),
        current_version,
        latest_version,
        needs_migration: current_version < latest_version,
    })
}

/// List available migrations for a target
#[tauri::command]
pub fn cmd_list_migrations(target: String) -> Result<Vec<MigrationInfoResponse>, String> {
    let target = parse_target(&target)?;

    let migrations = list_migrations(target);

    Ok(migrations
        .into_iter()
        .map(|m| MigrationInfoResponse {
            version: m.version,
            description: m.description.to_string(),
            is_rollbackable: m.is_rollbackable,
        })
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationInfoResponse {
    pub version: u32,
    pub description: String,
    pub is_rollbackable: bool,
}

/// Parses a target string into MigrationTarget
fn parse_target(target: &str) -> Result<MigrationTarget, String> {
    match target.to_lowercase().as_str() {
        "conversations" | "conversation" => Ok(MigrationTarget::Conversations),
        "rag" => Ok(MigrationTarget::Rag),
        _ => Err(format!(
            "Unknown migration target: '{}'. Valid targets: conversations, rag",
            target
        )),
    }
}
