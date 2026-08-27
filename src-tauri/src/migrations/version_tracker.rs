//! Version tracking for database migrations
//!
//! Manages the `_migrations` metadata table that tracks:
//! - Current schema version
//! - Migration history (which migrations were applied)
//! - Application timestamps

use crate::migrations::{MigrationResult, MigrationTarget};
use rusqlite::{Connection, Transaction};

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
