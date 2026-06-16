//! Version tracking for database migrations
//!
//! Manages the `_migrations` metadata table that tracks:
//! - Current schema version
//! - Migration history (which migrations were applied)
//! - Application timestamps for audit trails

use crate::migrations::{MigrationResult, MigrationTarget};
use rusqlite::{Connection, Transaction};
use std::time::Instant;

/// Gets the current schema version for the target database
pub fn get_current_version(conn: &Connection, target: MigrationTarget) -> MigrationResult<u32> {
    ensure_version_table(conn, target)?;

    let table_name = target.version_table();

    // Get the highest applied version
    let version: Option<u32> = conn
        .query_row(
            &format!("SELECT MAX(version) FROM {}", table_name),
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);

    Ok(version.unwrap_or(0))
}

/// Sets the current schema version using Connection
pub fn set_version(
    conn: &Connection,
    target: MigrationTarget,
    version: u32,
) -> MigrationResult<()> {
    let table_name = target.version_table();

    conn.execute(
        &format!(
            "INSERT OR REPLACE INTO {} (version, description, applied_at)
             VALUES (?1, ?2, ?3)",
            table_name
        ),
        rusqlite::params![version, "Version marker", chrono::Utc::now().to_rfc3339()],
    )?;

    Ok(())
}

/// Sets the current schema version using Transaction
pub fn set_version_tx(
    tx: &Transaction,
    target: MigrationTarget,
    version: u32,
) -> MigrationResult<()> {
    let table_name = target.version_table();

    tx.execute(
        &format!(
            "INSERT OR REPLACE INTO {} (version, description, applied_at)
             VALUES (?1, ?2, ?3)",
            table_name
        ),
        rusqlite::params![version, "Version marker", chrono::Utc::now().to_rfc3339()],
    )?;

    Ok(())
}

/// Records a migration application with timing information
pub fn record_migration(
    conn: &Connection,
    target: MigrationTarget,
    version: u32,
    description: &str,
    execution_time_ms: u64,
) -> MigrationResult<()> {
    let table_name = target.version_table();

    conn.execute(
        &format!(
            "INSERT OR REPLACE INTO {}
             (version, description, applied_at, execution_time_ms)
             VALUES (?1, ?2, ?3, ?4)",
            table_name
        ),
        rusqlite::params![
            version,
            description,
            chrono::Utc::now().to_rfc3339(),
            execution_time_ms as i64
        ],
    )?;

    Ok(())
}

/// Gets the migration history for audit/debugging
pub fn get_migration_history(
    conn: &Connection,
    target: MigrationTarget,
) -> MigrationResult<Vec<MigrationRecord>> {
    ensure_version_table(conn, target)?;

    let table_name = target.version_table();

    let mut stmt = conn.prepare(&format!(
        "SELECT version, description, applied_at, execution_time_ms
         FROM {}
         ORDER BY version ASC",
        table_name
    ))?;

    let records = stmt
        .query_map([], |row| {
            Ok(MigrationRecord {
                version: row.get(0)?,
                description: row.get(1)?,
                applied_at: row.get(2)?,
                execution_time_ms: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}

/// A recorded migration entry
#[derive(Debug, Clone)]
pub struct MigrationRecord {
    pub version: u32,
    pub description: String,
    pub applied_at: String,
    pub execution_time_ms: i64,
}

/// Ensures the version tracking table exists
fn ensure_version_table(conn: &Connection, target: MigrationTarget) -> MigrationResult<()> {
    let table_name = target.version_table();

    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now')),
                execution_time_ms INTEGER DEFAULT 0,
                checksum TEXT
            )",
            table_name
        ),
        [],
    )?;

    Ok(())
}

/// Measures execution time and records the migration
pub fn record_timed_migration<F>(
    conn: &Transaction,
    target: MigrationTarget,
    version: u32,
    description: &str,
    operation: F,
) -> MigrationResult<()>
where
    F: FnOnce() -> MigrationResult<()>,
{
    let start = Instant::now();

    operation()?;

    let duration_ms = start.elapsed().as_millis() as u64;

    record_migration_for_tx(conn, target, version, description, duration_ms)?;

    Ok(())
}

/// Records migration timing within a transaction
fn record_migration_for_tx(
    tx: &Transaction,
    target: MigrationTarget,
    version: u32,
    description: &str,
    execution_time_ms: u64,
) -> MigrationResult<()> {
    let table_name = target.version_table();

    tx.execute(
        &format!(
            "INSERT OR REPLACE INTO {}
             (version, description, applied_at, execution_time_ms)
             VALUES (?1, ?2, ?3, ?4)",
            table_name
        ),
        rusqlite::params![
            version,
            description,
            chrono::Utc::now().to_rfc3339(),
            execution_time_ms as i64
        ],
    )?;

    Ok(())
}

/// Checks if a specific migration version has been applied
pub fn is_migration_applied(
    conn: &Connection,
    target: MigrationTarget,
    version: u32,
) -> MigrationResult<bool> {
    ensure_version_table(conn, target)?;

    let table_name = target.version_table();

    let exists: bool = conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE version = ?1)",
            table_name
        ),
        [version],
        |row| row.get(0),
    )?;

    Ok(exists)
}
