//! Schema Migration Framework for Musaed
//!
//! Provides versioned migrations for SQLite databases with:
//! - Sequential migration execution
//! - Transaction-based atomicity
//! - Rollback support for rollbackable migrations
//! - Version tracking in dedicated metadata tables
//! - Idempotent execution (safe to re-run)
//!
//! # Architecture
//!
//! ```text
//! src-tauri/src/migrations/
//! ├── mod.rs               # Main orchestrator and public API
//! ├── traits.rs            # Migration trait definitions
//! ├── version_tracker.rs   # Version tracking and persistence
//! ├── rollback.rs          # Rollback coordination
//! ├── commands.rs          # Tauri commands for IPC
//! ├── conversations/       # Conversation database migrations
//! │   └── mod.rs
//! └── rag/                 # RAG database migrations
//!     └── mod.rs
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! // Run all pending migrations on the conversation database
//! use musaed_lib::migrations::{run_migrations, MigrationTarget};
//! use rusqlite::Connection;
//!
//! let conn = Connection::open("path/to/conversations.db")?;
//! let result = run_migrations(&conn, MigrationTarget::Conversations, None)?;
//!
//! // Run migrations up to a specific version
//! let result = run_migrations(&conn, MigrationTarget::Conversations, Some(5))?;
//!
//! // Rollback to a previous version
//! use musaed_lib::migrations::{rollback_to_version};
//! let result = rollback_to_version(&conn, MigrationTarget::Conversations, 3)?;
//! ```

pub mod commands;
pub mod rollback;
pub mod service;
pub mod traits;
pub mod version_tracker;

// Re-export main types
pub use crate::define_migration;
pub use commands::*;
pub use rollback::create_rollback_plan;
pub use traits::{DatabaseMigration, MigrationInfoTrait, MigrationMetadata, RollbackMigration};
pub use version_tracker::{
    get_current_version, get_migration_history, is_migration_applied, record_migration, set_version,
};

use rusqlite::{Connection, Transaction};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Migration error types
#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Migration {target} v{from}→v{to} failed: {message}")]
    MigrationFailed {
        target: String,
        from: u32,
        to: u32,
        message: String,
    },

    #[error("Rollback failed for {target} v{from}→v{to}: {message}")]
    RollbackFailed {
        target: String,
        from: u32,
        to: u32,
        message: String,
    },

    #[error("No migration found for {target} at version {version}")]
    MissingMigration { target: String, version: u32 },

    #[error("Invalid version sequence: cannot migrate from v{from} to v{to}")]
    InvalidVersionSequence { from: u32, to: u32 },

    #[error("Migration {target} v{version} is not rollbackable")]
    NotRollbackable { target: String, version: u32 },

    #[error("Data validation failed after migration: {0}")]
    ValidationError(String),
}

/// Result type for migration operations
pub type MigrationResult<T> = Result<T, MigrationError>;

/// Migration execution result
#[derive(Debug, Clone)]
pub struct MigrationExecutionResult {
    pub success: bool,
    pub from_version: u32,
    pub to_version: u32,
    pub applied_migrations: Vec<u32>,
    pub error: Option<String>,
}

/// Target database for migrations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationTarget {
    Conversations,
    Rag,
}

impl MigrationTarget {
    /// Returns the table name for version tracking
    pub fn version_table(&self) -> &'static str {
        match self {
            MigrationTarget::Conversations => "_conversations_migrations",
            MigrationTarget::Rag => "_rag_migrations",
        }
    }

    /// Returns the target name for logging
    pub fn as_str(&self) -> &'static str {
        match self {
            MigrationTarget::Conversations => "conversations",
            MigrationTarget::Rag => "rag",
        }
    }
}

/// A single migration step with up/down migrations
#[derive(Clone)]
pub struct MigrationStep {
    pub version: u32,
    pub description: &'static str,
    pub up: &'static [&'static str],
    pub down: Option<&'static [&'static str]>,
    pub is_rollbackable: bool,
}

impl MigrationStep {
    /// Creates a new rollbackable migration step
    pub fn new(
        version: u32,
        description: &'static str,
        up: &'static [&'static str],
        down: &'static [&'static str],
    ) -> Self {
        Self {
            version,
            description,
            up,
            down: Some(down),
            is_rollbackable: true,
        }
    }

    /// Creates a non-rollbackable migration step
    pub fn irreversible(
        version: u32,
        description: &'static str,
        up: &'static [&'static str],
    ) -> Self {
        Self {
            version,
            description,
            up,
            down: None,
            is_rollbackable: false,
        }
    }
}

/// Runs migrations for the specified target database
pub async fn run_migrations(
    conn: Arc<Mutex<Connection>>,
    target: MigrationTarget,
    target_version: Option<u32>,
) -> MigrationResult<MigrationExecutionResult> {
    let mut conn_guard = conn.lock().await;

    // Get current version
    let from_version = version_tracker::get_current_version(&conn_guard, target)?;
    let target_version = target_version.unwrap_or(get_latest_version(target));

    // No migration needed
    if from_version >= target_version {
        tracing::info!(
            target = target.as_str(),
            current = from_version,
            latest = target_version,
            "Already at target version"
        );
        return Ok(MigrationExecutionResult {
            success: true,
            from_version,
            to_version: from_version,
            applied_migrations: vec![],
            error: None,
        });
    }

    tracing::info!(
        target = target.as_str(),
        from = from_version,
        to = target_version,
        "Starting migration"
    );

    let mut applied_migrations = Vec::new();
    let mut current_version = from_version;

    // Run migrations sequentially within a transaction
    let tx = conn_guard.transaction()?;

    for next_version in (from_version + 1)..=target_version {
        let migration = get_migration(target, next_version).ok_or_else(|| {
            MigrationError::MissingMigration {
                target: target.as_str().to_string(),
                version: next_version,
            }
        })?;

        // Apply migration
        apply_migration_step(&tx, target, &migration)?;

        // Update version tracker
        version_tracker::set_version_tx(&tx, target, next_version)?;

        applied_migrations.push(next_version);
        current_version = next_version;

        tracing::info!(
            target = target.as_str(),
            version = next_version,
            description = migration.description,
            "Applied migration"
        );
    }

    tx.commit()?;

    tracing::info!(
        target = target.as_str(),
        from = from_version,
        to = current_version,
        "Migration completed successfully"
    );

    Ok(MigrationExecutionResult {
        success: true,
        from_version,
        to_version: current_version,
        applied_migrations,
        error: None,
    })
}

/// Applies a single migration step within a transaction
fn apply_migration_step(
    tx: &Transaction,
    target: MigrationTarget,
    migration: &MigrationStep,
) -> MigrationResult<()> {
    for sql in migration.up {
        tx.execute_batch(sql)?;
    }

    tracing::debug!(
        target = target.as_str(),
        version = migration.version,
        "Executed migration SQL"
    );

    Ok(())
}

/// Runs migrations synchronously on a `&Connection`.
///
/// This is the synchronous counterpart to [`run_migrations`], intended for
/// connection-time schema evolution where an async runtime is not available.
/// It reuses the same canonical [`MigrationStep`] definitions and
/// [`version_tracker`] infrastructure so there is a single migration owner.
///
/// On a fresh database (version 0) the caller is expected to have already
/// executed the full current schema DDL. This function stamps the version
/// to `LATEST_VERSION` without re-running migrations, then returns. On
/// existing databases it applies incremental migration steps from the
/// recorded version up to `LATEST_VERSION`.
pub fn run_migrations_sync(
    conn: &mut Connection,
    target: MigrationTarget,
) -> MigrationResult<MigrationExecutionResult> {
    let from_version = version_tracker::get_current_version(conn, target)?;
    let target_version = get_latest_version(target);

    if from_version >= target_version {
        tracing::info!(
            target = target.as_str(),
            current = from_version,
            latest = target_version,
            "Already at target version"
        );
        return Ok(MigrationExecutionResult {
            success: true,
            from_version,
            to_version: from_version,
            applied_migrations: vec![],
            error: None,
        });
    }

    tracing::info!(
        target = target.as_str(),
        from = from_version,
        to = target_version,
        "Starting sync migration"
    );

    let mut applied_migrations = Vec::new();
    let mut current_version = from_version;

    let tx = conn.transaction()?;

    // Fresh database: schema DDL already executed by the caller. Stamp the
    // version to LATEST_VERSION so incremental migrations are skipped.
    if from_version == 0 {
        version_tracker::set_version_tx(&tx, target, target_version)?;
        tx.commit()?;

        tracing::info!(
            target = target.as_str(),
            version = target_version,
            "Stamped fresh database to latest version"
        );

        return Ok(MigrationExecutionResult {
            success: true,
            from_version,
            to_version: target_version,
            applied_migrations: vec![],
            error: None,
        });
    }

    for next_version in (from_version + 1)..=target_version {
        let migration = get_migration(target, next_version).ok_or_else(|| {
            MigrationError::MissingMigration {
                target: target.as_str().to_string(),
                version: next_version,
            }
        })?;

        apply_migration_step(&tx, target, &migration)?;

        version_tracker::set_version_tx(&tx, target, next_version)?;

        applied_migrations.push(next_version);
        current_version = next_version;

        tracing::info!(
            target = target.as_str(),
            version = next_version,
            description = migration.description,
            "Applied sync migration"
        );
    }

    tx.commit()?;

    tracing::info!(
        target = target.as_str(),
        from = from_version,
        to = current_version,
        "Sync migration completed successfully"
    );

    Ok(MigrationExecutionResult {
        success: true,
        from_version,
        to_version: current_version,
        applied_migrations,
        error: None,
    })
}

/// Rolls back to a previous version
pub async fn rollback_to_version(
    conn: Arc<Mutex<Connection>>,
    target: MigrationTarget,
    to_version: u32,
) -> MigrationResult<MigrationExecutionResult> {
    let mut conn_guard = conn.lock().await;

    let from_version = version_tracker::get_current_version(&conn_guard, target)?;

    // Validate rollback sequence
    if to_version >= from_version {
        return Err(MigrationError::InvalidVersionSequence {
            from: from_version,
            to: to_version,
        });
    }

    tracing::info!(
        target = target.as_str(),
        from = from_version,
        to = to_version,
        "Starting rollback"
    );

    let mut applied_rollbacks = Vec::new();
    let mut current_version = from_version;

    let tx = conn_guard.transaction()?;

    // Rollback in reverse order
    for version in (to_version + 1..=from_version).rev() {
        let migration =
            get_migration(target, version).ok_or_else(|| MigrationError::MissingMigration {
                target: target.as_str().to_string(),
                version,
            })?;

        if !migration.is_rollbackable {
            return Err(MigrationError::NotRollbackable {
                target: target.as_str().to_string(),
                version,
            });
        }

        let down_sql = migration
            .down
            .ok_or_else(|| MigrationError::NotRollbackable {
                target: target.as_str().to_string(),
                version,
            })?;

        // Apply rollback
        for sql in down_sql {
            tx.execute_batch(sql)?;
        }

        applied_rollbacks.push(version);
        current_version = version - 1;
    }

    // Update version tracker
    version_tracker::set_version_tx(&tx, target, current_version)?;

    tx.commit()?;

    tracing::info!(
        target = target.as_str(),
        from = from_version,
        to = current_version,
        "Rollback completed successfully"
    );

    Ok(MigrationExecutionResult {
        success: true,
        from_version,
        to_version: current_version,
        applied_migrations: applied_rollbacks,
        error: None,
    })
}

/// Gets the migration step for a specific version
fn get_migration(target: MigrationTarget, version: u32) -> Option<MigrationStep> {
    match target {
        MigrationTarget::Conversations => conversations::get_migration(version),
        MigrationTarget::Rag => rag::get_migration(version),
    }
}

/// Gets the latest migration version for a target
pub fn get_latest_version(target: MigrationTarget) -> u32 {
    match target {
        MigrationTarget::Conversations => conversations::LATEST_VERSION,
        MigrationTarget::Rag => rag::LATEST_VERSION,
    }
}

/// Gets all available migrations for a target
pub fn list_migrations(target: MigrationTarget) -> Vec<MigrationStep> {
    match target {
        MigrationTarget::Conversations => conversations::list_all(),
        MigrationTarget::Rag => rag::list_all(),
    }
}

// Sub-modules for specific database migrations
mod conversations;
mod rag;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// Creates an in-memory test database for the specified target
    fn create_test_db(target: MigrationTarget) -> Arc<Mutex<Connection>> {
        let conn = Connection::open(":memory:").expect("Failed to create in-memory DB");

        // Initialize version table
        let table_name = target.version_table();
        conn.execute(
            &format!(
                "CREATE TABLE IF NOT EXISTS {} (
                    version INTEGER PRIMARY KEY,
                    description TEXT NOT NULL,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
                    execution_time_ms INTEGER DEFAULT 0
                )",
                table_name
            ),
            [],
        )
        .expect("Failed to create version table");

        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn test_run_migrations_already_at_target() {
        let conn = create_test_db(MigrationTarget::Conversations);

        // Set initial version to latest
        {
            let conn_guard = conn.lock().await;
            version_tracker::set_version(&conn_guard, MigrationTarget::Conversations, 4)
                .expect("Failed to set version");
        }

        let result = run_migrations(conn.clone(), MigrationTarget::Conversations, None)
            .await
            .expect("Migration failed");

        assert!(result.success);
        assert_eq!(result.from_version, 4);
        assert_eq!(result.to_version, 4);
        assert!(result.applied_migrations.is_empty());
    }

    #[tokio::test]
    async fn test_run_migrations_from_scratch() {
        let conn = create_test_db(MigrationTarget::Conversations);

        let result = run_migrations(conn.clone(), MigrationTarget::Conversations, None)
            .await
            .expect("Migration failed");

        assert!(result.success);
        assert_eq!(result.from_version, 0);
        assert_eq!(result.to_version, 4); // Latest version
        assert_eq!(result.applied_migrations, vec![1, 2, 3, 4]);
    }

    #[tokio::test]
    async fn test_rollback_success() {
        let conn = create_test_db(MigrationTarget::Conversations);

        // Migrate to v4
        run_migrations(conn.clone(), MigrationTarget::Conversations, None)
            .await
            .expect("Migration failed");

        // Rollback to v3
        let result = rollback_to_version(conn.clone(), MigrationTarget::Conversations, 3)
            .await
            .expect("Rollback failed");

        assert!(result.success);
        assert_eq!(result.from_version, 4);
        assert_eq!(result.to_version, 3);
    }

    #[tokio::test]
    async fn test_rollback_invalid_sequence() {
        let conn = create_test_db(MigrationTarget::Conversations);

        // Migrate to v4
        run_migrations(conn.clone(), MigrationTarget::Conversations, None)
            .await
            .expect("Migration failed");

        // Try to rollback to v5 (invalid - higher than current)
        let result = rollback_to_version(conn.clone(), MigrationTarget::Conversations, 5).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_idempotent_migration() {
        let conn = create_test_db(MigrationTarget::Conversations);

        // Run migrations twice - should succeed both times
        let result1 = run_migrations(conn.clone(), MigrationTarget::Conversations, None)
            .await
            .expect("First migration failed");

        let result2 = run_migrations(conn.clone(), MigrationTarget::Conversations, None)
            .await
            .expect("Second migration failed");

        assert!(result1.success);
        assert!(result2.success);
        assert_eq!(result2.applied_migrations.len(), 0); // No migrations applied second time
    }

    #[tokio::test]
    async fn test_rag_migrations() {
        let conn = create_test_db(MigrationTarget::Rag);

        let result = run_migrations(conn.clone(), MigrationTarget::Rag, None)
            .await
            .expect("Migration failed");

        assert!(result.success);
        assert_eq!(result.from_version, 0);
        assert_eq!(result.to_version, 3); // Latest RAG version
    }

    #[tokio::test]
    async fn test_list_migrations() {
        let conversations_migrations = list_migrations(MigrationTarget::Conversations);
        assert_eq!(conversations_migrations.len(), 4); // v1, v2, v3, and v4

        let rag_migrations = list_migrations(MigrationTarget::Rag);
        assert_eq!(rag_migrations.len(), 3); // v1, v2, and v3
    }

    #[tokio::test]
    async fn test_get_latest_version() {
        assert_eq!(get_latest_version(MigrationTarget::Conversations), 4);
        assert_eq!(get_latest_version(MigrationTarget::Rag), 3);
    }
}
