//! Migration trait definitions and common utilities

use rusqlite::{Connection, Transaction};

/// Trait defining a database migration
pub trait DatabaseMigration {
    /// Target database name
    const TARGET: &'static str;

    /// Migration version (e.g., 1, 2, 3)
    const VERSION: u32;

    /// Human-readable description of what this migration does
    const DESCRIPTION: &'static str;

    /// Whether this migration can be rolled back
    const IS_ROLLBACKABLE: bool;

    /// SQL statements to apply the migration (UP)
    const UP: &'static [&'static str];

    /// SQL statements to rollback the migration (DOWN)
    /// None means the migration cannot be rolled back
    const DOWN: Option<&'static [&'static str]>;

    /// Optional post-migration validation
    /// Returns Ok(()) if data is valid, Err with message if invalid
    fn validate(_conn: &Connection) -> Result<(), String> {
        Ok(())
    }

    /// Optional pre-migration hooks (data transformation, etc.)
    fn before_migration(_conn: &Transaction) -> Result<(), rusqlite::Error> {
        Ok(())
    }

    /// Optional post-migration hooks
    fn after_migration(_conn: &Transaction) -> Result<(), rusqlite::Error> {
        Ok(())
    }
}

/// Trait for rollback operations
pub trait RollbackMigration: DatabaseMigration {
    /// Custom rollback logic if SQL alone is insufficient
    /// Returns Ok(()) if rollback succeeded
    fn custom_rollback(_conn: &Transaction) -> Result<(), rusqlite::Error> {
        Ok(())
    }
}

/// Helper macro to define a migration with common patterns
#[macro_export]
macro_rules! define_migration {
    (
        target = $target:expr,
        version = $version:expr,
        description = $desc:expr,
        rollbackable = $rollbackable:expr,
        up = [$( $up:literal ),* $(,)?],
        down = [$( $down:literal ),* $(,)?] $(,)?
    ) => {
        pub struct Migration;

        impl DatabaseMigration for Migration {
            const TARGET: &'static str = $target;
            const VERSION: u32 = $version;
            const DESCRIPTION: &'static str = $desc;
            const IS_ROLLBACKABLE: bool = $rollbackable;
            const UP: &'static [&'static str] = &[$( $up ),*];
            const DOWN: Option<&'static [&'static str]> = if $rollbackable {
                Some(&[$( $down ),*])
            } else {
                None
            };
        }
    };
}

/// Migration metadata for tracking
#[derive(Debug, Clone)]
pub struct MigrationMetadata {
    pub version: u32,
    pub name: &'static str,
    pub description: &'static str,
    pub applied_at: String,
    pub execution_time_ms: u64,
}

impl MigrationMetadata {
    pub fn new(version: u32, name: &'static str, description: &'static str) -> Self {
        Self {
            version,
            name,
            description,
            applied_at: chrono::Utc::now().to_rfc3339(),
            execution_time_ms: 0,
        }
    }

    pub fn with_execution_time(mut self, ms: u64) -> Self {
        self.execution_time_ms = ms;
        self
    }
}

/// Migration registry for lookups
pub struct MigrationRegistry {
    pub migrations: Vec<Box<dyn Fn() -> Box<dyn MigrationInfo> + Send + Sync>>,
}

pub trait MigrationInfo {
    fn target(&self) -> &'static str;
    fn version(&self) -> u32;
    fn description(&self) -> &'static str;
    fn is_rollbackable(&self) -> bool;
}

/// Ensures idempotency by checking if migration was already applied
pub fn is_migration_applied(
    conn: &Connection,
    target: &str,
    version: u32,
) -> Result<bool, rusqlite::Error> {
    let table_name = format!("_{}_migrations", target);

    // Check if table exists first
    let table_exists: bool = conn.query_row(
        "SELECT EXISTS (
            SELECT 1 FROM sqlite_master 
            WHERE type='table' AND name=?1
        )",
        [table_name.as_str()],
        |row| row.get(0),
    )?;

    if !table_exists {
        return Ok(false);
    }

    conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE version = ?1)",
            table_name
        ),
        [version],
        |row| row.get(0),
    )
}

/// Marks a migration as applied in the version tracker table
pub fn mark_migration_applied(
    conn: &Transaction,
    target: &str,
    version: u32,
    description: &str,
) -> Result<(), rusqlite::Error> {
    let table_name = format!("_{}_migrations", target);

    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO {} (version, description, applied_at) VALUES (?1, ?2, ?3)",
            table_name
        ),
        rusqlite::params![version, description, chrono::Utc::now().to_rfc3339()],
    )?;

    Ok(())
}

/// Creates the version tracking table if it doesn't exist
pub fn ensure_version_table(conn: &Connection, target: &str) -> Result<(), rusqlite::Error> {
    let table_name = format!("_{}_migrations", target);

    conn.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL,
                execution_time_ms INTEGER DEFAULT 0,
                checksum TEXT
            )",
            table_name
        ),
        [],
    )?;

    Ok(())
}
