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
//! ├── version_tracker.rs   # Version tracking and persistence
//! ├── commands.rs          # Tauri commands for IPC
//! └── conversations/       # Conversation database migrations
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
//! let mut conn = Connection::open("path/to/conversations.db")?;
//! let result = run_migrations(&mut conn, MigrationTarget::Conversations, None)?;
//!
//! // Run migrations up to a specific version
//! let result = run_migrations(&mut conn, MigrationTarget::Conversations, Some(5))?;
//!
//! // Rollback to a previous version
//! use musaed_lib::migrations::{rollback_to_version};
//! let result = rollback_to_version(&mut conn, MigrationTarget::Conversations, 3)?;
//! ```

pub mod commands;
pub mod service;
pub mod version_tracker;

// Re-export main types
pub use commands::*;
pub use version_tracker::{get_current_version, set_version};

use rusqlite::{Connection, Transaction};

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

/// Runs migrations for the specified target database.
///
/// Synchronous: callers must already hold exclusive access to the connection.
pub fn run_migrations(
    conn: &mut Connection,
    target: MigrationTarget,
    target_version: Option<u32>,
) -> MigrationResult<MigrationExecutionResult> {
    // Get current version
    let from_version = version_tracker::get_current_version(conn, target)?;
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

    let applied_migrations = apply_pending(conn, target, from_version, target_version)?;
    let current_version = applied_migrations.last().copied().unwrap_or(from_version);

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

/// Applies one migration step within a transaction.
///
/// Tolerates "duplicate column name" errors with a warning: when SCHEMA_SQL
/// (the fresh-create path) and the migration chain drift — e.g. a column was
/// added to SCHEMA_SQL on one branch and to a migration on another — a
/// database that already carries the column would otherwise fail on every
/// boot. Any other error propagates unchanged.
fn apply_migration_step(
    tx: &Transaction,
    target: MigrationTarget,
    migration: &MigrationStep,
) -> MigrationResult<()> {
    for sql in migration.up {
        if let Err(e) = tx.execute_batch(sql) {
            if e.to_string().contains("duplicate column name") {
                tracing::warn!(
                    target = target.as_str(),
                    version = migration.version,
                    error = %e,
                    "Migration step hit a column that already exists (schema/migration drift); skipping"
                );
            } else {
                return Err(e.into());
            }
        }
    }

    tracing::debug!(
        target = target.as_str(),
        version = migration.version,
        "Executed migration SQL"
    );

    Ok(())
}

/// Shared apply loop: runs every step in `(from_version, target_version]`
/// inside a single transaction, stamping the version tracker per step.
/// Returns the applied version list. Both `run_migrations` and
/// `run_migrations_sync` delegate here so the apply logic lives in one place
/// (Rust #13).
fn apply_pending(
    conn: &mut Connection,
    target: MigrationTarget,
    from_version: u32,
    target_version: u32,
) -> MigrationResult<Vec<u32>> {
    let mut applied_migrations = Vec::new();
    let tx = conn.transaction()?;

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

        tracing::info!(
            target = target.as_str(),
            version = next_version,
            description = migration.description,
            "Applied migration"
        );
    }

    tx.commit()?;
    Ok(applied_migrations)
}

/// Runs migrations synchronously on a `&mut Connection` at connection time.
///
/// Intended for connection-time schema evolution. It reuses the same
/// canonical [`MigrationStep`] definitions and [`version_tracker`]
/// infrastructure as [`run_migrations`] so there is a single migration owner.
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

    // Fresh database: schema DDL already executed by the caller. Stamp the
    // version to LATEST_VERSION so incremental migrations are skipped.
    if from_version == 0 {
        version_tracker::set_version(conn, target, target_version)?;

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

    let applied_migrations = apply_pending(conn, target, from_version, target_version)?;
    let current_version = applied_migrations.last().copied().unwrap_or(from_version);

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

/// Rolls back to a previous version.
///
/// Synchronous: callers must already hold exclusive access to the connection.
pub fn rollback_to_version(
    conn: &mut Connection,
    target: MigrationTarget,
    to_version: u32,
) -> MigrationResult<MigrationExecutionResult> {
    let from_version = version_tracker::get_current_version(conn, target)?;

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

    let tx = conn.transaction()?;

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

/// Migrate a RAG database whose versioning used the legacy
/// `PRAGMA user_version` scheme (v0..v3) into this framework.
///
/// Bridge: read `PRAGMA user_version`; if the `_rag_migrations` tracker is
/// empty (legacy DB), seed the tracker with the legacy version so the
/// framework never re-applies steps already applied. Then run the normal
/// apply loop. The legacy pragma is then left in sync (informational).
pub fn migrate_rag_db(conn: &mut Connection) -> MigrationResult<MigrationExecutionResult> {
    let target = MigrationTarget::Rag;

    // 1. Baseline: if the tracker is empty but PRAGMA user_version says we
    //    have schema, stamp the tracker with the legacy version so the
    //    framework skips already-applied steps.
    // get_current_version ensures the tracker table exists, so do this first.
    let tracker_version = version_tracker::get_current_version(conn, target)?;

    let legacy_version: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);

    if tracker_version == 0 && legacy_version > 0 {
        // Legacy DB predating the framework: stamp the tracker without
        // re-running the steps (the legacy schema is already in place).
        version_tracker::set_version(conn, target, legacy_version.min(get_latest_version(target)))?;
    }

    // 2. Truly-fresh DB (SCHEMA_SQL just ran, no status column is the probe):
    //    stamp to latest without re-running. A legacy v0 DB (no pragma ever
    //    set, no status column) must still run v1..v3.
    if tracker_version == 0 && legacy_version == 0 {
        let has_status = conn.prepare("SELECT status FROM projects LIMIT 0").is_ok();
        if has_status {
            let result = run_migrations_sync(conn, target)?; // stamps to latest
            conn.execute_batch(&format!(
                "PRAGMA user_version = {}",
                get_latest_version(target)
            ))?;
            return Ok(result);
        }
        // legacy v0: fall through and run the apply loop from version 0
    }

    let result = run_migrations(conn, target, Some(get_latest_version(target)))?;
    // Keep the legacy pragma in sync for any external tooling.
    conn.execute_batch(&format!(
        "PRAGMA user_version = {}",
        get_latest_version(target)
    ))?;
    Ok(result)
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
pub mod rag;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Creates an in-memory test database for the specified target
    fn create_test_db(target: MigrationTarget) -> Connection {
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

        conn
    }

    #[test]
    fn test_run_migrations_already_at_target() {
        let mut conn = create_test_db(MigrationTarget::Conversations);

        // Set initial version to latest
        version_tracker::set_version(&conn, MigrationTarget::Conversations, 7)
            .expect("Failed to set version");

        let result = run_migrations(&mut conn, MigrationTarget::Conversations, None)
            .expect("Migration failed");

        assert!(result.success);
        assert_eq!(result.from_version, 7);
        assert_eq!(result.to_version, 7);
        assert!(result.applied_migrations.is_empty());
    }

    #[test]
    fn test_run_migrations_from_scratch() {
        let mut conn = create_test_db(MigrationTarget::Conversations);

        let result = run_migrations(&mut conn, MigrationTarget::Conversations, None)
            .expect("Migration failed");

        assert!(result.success);
        assert_eq!(result.from_version, 0);
        assert_eq!(result.to_version, 7); // Latest version
        assert_eq!(result.applied_migrations, vec![1, 2, 3, 4, 5, 6, 7]);
    }

    #[test]
    fn test_rollback_success() {
        let mut conn = create_test_db(MigrationTarget::Conversations);

        // Migrate to latest
        run_migrations(&mut conn, MigrationTarget::Conversations, None).expect("Migration failed");

        // Rollback to v4
        let result = rollback_to_version(&mut conn, MigrationTarget::Conversations, 4)
            .expect("Rollback failed");

        assert!(result.success);
        assert_eq!(result.from_version, 7);
        assert_eq!(result.to_version, 4);
    }

    #[test]
    fn test_rollback_invalid_sequence() {
        let mut conn = create_test_db(MigrationTarget::Conversations);

        // Migrate to latest
        run_migrations(&mut conn, MigrationTarget::Conversations, None).expect("Migration failed");

        // Try to rollback to v7 (invalid - higher than current)
        let result = rollback_to_version(&mut conn, MigrationTarget::Conversations, 7);

        assert!(result.is_err());
    }

    #[test]
    fn test_idempotent_migration() {
        let mut conn = create_test_db(MigrationTarget::Conversations);

        // Run migrations twice - should succeed both times
        let result1 = run_migrations(&mut conn, MigrationTarget::Conversations, None)
            .expect("First migration failed");

        let result2 = run_migrations(&mut conn, MigrationTarget::Conversations, None)
            .expect("Second migration failed");

        assert!(result1.success);
        assert!(result2.success);
        assert_eq!(result2.applied_migrations.len(), 0); // No migrations applied second time
    }

    #[test]
    fn test_list_migrations() {
        let conversations_migrations = list_migrations(MigrationTarget::Conversations);
        assert_eq!(conversations_migrations.len(), 7); // v1–v7
    }

    #[test]
    fn test_duplicate_column_step_is_tolerated_with_warning() {
        // Regression: a database whose `error` column already exists (via
        // SCHEMA_SQL fresh-create) must not fail when the v7 patch runs the
        // idempotent-by-tolerance ADD COLUMN again.
        let mut conn = create_test_db(MigrationTarget::Conversations);
        // Build a minimal messages table carrying `error` already, so the v7
        // ALTER would duplicate it.
        conn.execute_batch("CREATE TABLE messages (id TEXT PRIMARY KEY, error TEXT)")
            .unwrap();
        version_tracker::set_version(&conn, MigrationTarget::Conversations, 6).unwrap();

        let result = run_migrations(&mut conn, MigrationTarget::Conversations, None).unwrap();
        assert!(
            result.success,
            "duplicate column must not fail the migration"
        );
        assert_eq!(result.applied_migrations, vec![7]);
    }

    #[test]
    fn test_get_latest_version() {
        assert_eq!(get_latest_version(MigrationTarget::Conversations), 7);
    }
}
