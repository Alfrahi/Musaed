use crate::conversation::store::ConversationStore;
use crate::error_codes;
use crate::migrations::{
    get_latest_version, list_migrations, rollback_to_version, run_migrations, version_tracker,
    MigrationInfo, MigrationStatus, MigrationTarget, RunMigrationsRequest, RunMigrationsResponse,
};
use crate::payloads::{ApiResponse, BackendError};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Parses a target string into a `MigrationTarget`.
fn parse_target(target: &str) -> Result<MigrationTarget, String> {
    match target.to_lowercase().as_str() {
        "conversations" | "conversation" => Ok(MigrationTarget::Conversations),
        _ => Err(format!(
            "Unknown migration target: '{}'. Valid targets: conversations",
            target
        )),
    }
}

/// Run migrations for the requested target.
pub async fn run(
    conversation_store: Arc<Mutex<ConversationStore>>,
    request: RunMigrationsRequest,
) -> ApiResponse<RunMigrationsResponse> {
    let target = match parse_target(&request.target) {
        Ok(t) => t,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(error_codes::MIGRATION_ERROR, e)),
            }
        }
    };
    let store = conversation_store.lock().await;
    let mut conn = store.lock_conn().await;
    match run_migrations(&mut conn, target, request.target_version) {
        Ok(result) => ApiResponse {
            success: result.success,
            data: Some(RunMigrationsResponse {
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
            }),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::MIGRATION_ERROR,
                e.to_string(),
            )),
        },
    }
}

/// Roll back migrations to a previous version.
pub async fn rollback(
    conversation_store: Arc<Mutex<ConversationStore>>,
    target_str: String,
    to_version: u32,
) -> ApiResponse<RunMigrationsResponse> {
    let target = match parse_target(&target_str) {
        Ok(t) => t,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(error_codes::MIGRATION_ERROR, e)),
            }
        }
    };
    let store = conversation_store.lock().await;
    let mut conn = store.lock_conn().await;
    match rollback_to_version(&mut conn, target, to_version) {
        Ok(result) => ApiResponse {
            success: result.success,
            data: Some(RunMigrationsResponse {
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
            }),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::MIGRATION_ERROR,
                e.to_string(),
            )),
        },
    }
}

/// Get migration status for a target.
pub async fn status(
    conversation_store: Arc<Mutex<ConversationStore>>,
    target_str: String,
) -> ApiResponse<MigrationStatus> {
    let target = match parse_target(&target_str) {
        Ok(t) => t,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(error_codes::MIGRATION_ERROR, e)),
            }
        }
    };
    let store = conversation_store.lock().await;
    let conn_guard = store.lock_conn().await;
    match version_tracker::get_current_version(&conn_guard, target) {
        Ok(current_version) => {
            let latest_version = get_latest_version(target);
            ApiResponse {
                success: true,
                data: Some(MigrationStatus {
                    target: target.as_str().to_string(),
                    current_version,
                    latest_version,
                    needs_migration: current_version < latest_version,
                }),
                error: None,
            }
        }
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::MIGRATION_ERROR,
                e.to_string(),
            )),
        },
    }
}

/// List available migrations for a target.
pub fn list(target_str: String) -> ApiResponse<Vec<MigrationInfo>> {
    let target = match parse_target(&target_str) {
        Ok(t) => t,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(error_codes::MIGRATION_ERROR, e)),
            }
        }
    };
    let migrations = list_migrations(target);
    ApiResponse {
        success: true,
        data: Some(
            migrations
                .into_iter()
                .map(|m| MigrationInfo {
                    version: m.version,
                    description: m.description.to_string(),
                    is_rollbackable: m.is_rollbackable,
                })
                .collect(),
        ),
        error: None,
    }
}
