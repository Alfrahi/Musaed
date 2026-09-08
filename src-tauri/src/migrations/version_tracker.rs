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

    // Get the highest applied version. Propagate DB errors instead of
    // swallowing them via unwrap_or (misdiagnosis) or panicking on Err.
    let version: Option<u32> = conn.query_row(
        &format!("SELECT MAX(version) FROM {}", table_name),
        [],
        |row| row.get(0),
    )?;

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

    // Legacy `_rag_migrations` tables from the probe-era versioning scheme
    // (schema `(name TEXT PRIMARY KEY, value TEXT)`, e.g. the
    // `vec_cosine_metric` row) are incompatible with the framework's shape.
    // `CREATE TABLE IF NOT EXISTS` leaves them in place, and every
    // `SELECT version ...` then fails — `open_connection` errors and the RAG
    // store silently degrades to a vec-disabled fallback. The legacy table
    // holds no framework versions, so drop it and let the bridge in
    // `migrate_rag_db` restamp from `PRAGMA user_version`.
    if conn
        .prepare(&format!("SELECT version FROM {table_name} LIMIT 0"))
        .is_err()
    {
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {table_name}"))?;
    }

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
