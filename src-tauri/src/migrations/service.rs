use crate::migrations::{
    get_latest_version, list_migrations, rollback_to_version, run_migrations, version_tracker,
    MigrationInfo, MigrationStatus, MigrationTarget, RunMigrationsRequest, RunMigrationsResponse,
};
use rusqlite::Connection;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Parses a target string into a `MigrationTarget`.
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

/// Run migrations for the requested target.
pub async fn run(
    conversation_store: Arc<Mutex<Connection>>,
    rag_store: Arc<Mutex<Connection>>,
    request: RunMigrationsRequest,
) -> Result<RunMigrationsResponse, String> {
    let target = parse_target(&request.target)?;
    let store = match target {
        MigrationTarget::Conversations => conversation_store,
        MigrationTarget::Rag => rag_store,
    };
    let result = run_migrations(store, target, request.target_version)
        .await
        .map_err(|e| e.to_string())?;
    Ok(RunMigrationsResponse {
        success: result.success,
        from_version: result.from_version,
        to_version: result.to_version,
        applied_migrations: result.applied_migrations,
        error: result
            .error
            .map(|e| crate::migrations::MigrationErrorDetail {
                code: "UNKNOWN".to_string(),
                message: e,
            }),
    })
}

/// Roll back migrations to a previous version.
pub async fn rollback(
    conversation_store: Arc<Mutex<Connection>>,
    rag_store: Arc<Mutex<Connection>>,
    target_str: String,
    to_version: u32,
) -> Result<RunMigrationsResponse, String> {
    let target = parse_target(&target_str)?;
    let store = match target {
        MigrationTarget::Conversations => conversation_store,
        MigrationTarget::Rag => rag_store,
    };
    let result = rollback_to_version(store, target, to_version)
        .await
        .map_err(|e| e.to_string())?;
    Ok(RunMigrationsResponse {
        success: result.success,
        from_version: result.from_version,
        to_version: result.to_version,
        applied_migrations: result.applied_migrations,
        error: result
            .error
            .map(|e| crate::migrations::MigrationErrorDetail {
                code: "UNKNOWN".to_string(),
                message: e,
            }),
    })
}

/// Get migration status for a target.
pub async fn status(
    conversation_store: Arc<Mutex<Connection>>,
    rag_store: Arc<Mutex<Connection>>,
    target_str: String,
) -> Result<MigrationStatus, String> {
    let target = parse_target(&target_str)?;
    let store = match target {
        MigrationTarget::Conversations => conversation_store,
        MigrationTarget::Rag => rag_store,
    };
    let conn_guard = store.lock().await;
    let current_version =
        version_tracker::get_current_version(&conn_guard, target).map_err(|e| e.to_string())?;
    let latest_version = get_latest_version(target);
    Ok(MigrationStatus {
        target: target.as_str().to_string(),
        current_version,
        latest_version,
        needs_migration: current_version < latest_version,
    })
}

/// List available migrations for a target.
pub fn list(target_str: String) -> Result<Vec<MigrationInfo>, String> {
    let target = parse_target(&target_str)?;
    let migrations = list_migrations(target);
    Ok(migrations
        .into_iter()
        .map(|m| MigrationInfo {
            version: m.version,
            description: m.description.to_string(),
            is_rollbackable: m.is_rollbackable,
        })
        .collect())
}
