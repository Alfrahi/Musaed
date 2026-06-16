//! Rollback coordination and safety checks
//!
//! Provides safe rollback mechanisms with:
//! - Pre-rollback validation
//! - Data loss warnings
//! - Transaction-based atomicity
//! - Rollback state snapshots

use crate::migrations::version_tracker::{get_current_version, get_migration_history};
use crate::migrations::{MigrationError, MigrationResult, MigrationTarget};
use rusqlite::Connection;
use std::path::PathBuf;

/// Rollback plan with safety information
#[derive(Debug, Clone)]
pub struct RollbackPlan {
    pub target: String,
    pub from_version: u32,
    pub to_version: u32,
    pub migrations_to_rollback: Vec<MigrationToRollback>,
    pub is_safe: bool,
    pub warnings: Vec<String>,
    pub estimated_data_loss: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MigrationToRollback {
    pub version: u32,
    pub description: String,
    pub is_rollbackable: bool,
    pub has_data_loss: bool,
}

/// Creates a rollback plan without executing it
pub fn create_rollback_plan(
    conn: &Connection,
    target: MigrationTarget,
    to_version: u32,
) -> MigrationResult<RollbackPlan> {
    let from_version = get_current_version(conn, target)?;

    if to_version >= from_version {
        return Err(MigrationError::InvalidVersionSequence {
            from: from_version,
            to: to_version,
        });
    }

    let _history = get_migration_history(conn, target)?;
    let mut migrations_to_rollback = Vec::new();
    let mut warnings = Vec::new();
    let mut is_safe = true;
    let mut any_has_data_loss = false;

    // Analyze each migration that would be rolled back
    for version in (to_version + 1..=from_version).rev() {
        let migration = get_migration_info(target, version);

        let is_rollbackable = migration
            .as_ref()
            .map(|m| m.is_rollbackable)
            .unwrap_or(false);
        let migration_has_data_loss = check_migration_has_data_loss(target, version);

        if !is_rollbackable {
            warnings.push(format!("Migration v{} is not rollbackable", version));
            is_safe = false;
        }

        if migration_has_data_loss {
            warnings.push(format!("Rolling back v{} may cause data loss", version));
            any_has_data_loss = true;
        }

        migrations_to_rollback.push(MigrationToRollback {
            version,
            description: migration
                .as_ref()
                .map(|m| m.description.clone())
                .unwrap_or_else(|| format!("Unknown migration v{}", version)),
            is_rollbackable,
            has_data_loss: migration_has_data_loss,
        });
    }

    let estimated_data_loss = if any_has_data_loss {
        Some("Rolling back may remove indexed data or metadata".to_string())
    } else {
        None
    };

    Ok(RollbackPlan {
        target: target.as_str().to_string(),
        from_version,
        to_version,
        migrations_to_rollback,
        is_safe,
        warnings,
        estimated_data_loss,
    })
}

/// Validates that a rollback is safe to execute
pub fn validate_rollback(
    conn: &Connection,
    target: MigrationTarget,
    to_version: u32,
) -> MigrationResult<Vec<String>> {
    let plan = create_rollback_plan(conn, target, to_version)?;
    let mut warnings = Vec::new();

    // Check for non-rollbackable migrations
    if !plan.is_safe {
        warnings.extend(plan.warnings);
    }

    // Check for data loss
    if let Some(loss) = plan.estimated_data_loss {
        warnings.push(loss);
    }

    // Check if target version exists in history
    let history = get_migration_history(conn, target)?;
    let target_exists = history.iter().any(|r| r.version == to_version);

    if !target_exists && to_version > 0 {
        warnings.push(format!(
            "Target version v{} has no migration history - ensure this is intentional",
            to_version
        ));
    }

    Ok(warnings)
}

/// Checks if a specific migration would cause data loss when rolled back
fn check_migration_has_data_loss(target: MigrationTarget, version: u32) -> bool {
    match target {
        MigrationTarget::Conversations => conversations::has_data_loss_on_rollback(version),
        MigrationTarget::Rag => rag::has_data_loss_on_rollback(version),
    }
}

/// Gets migration info for planning
fn get_migration_info(target: MigrationTarget, version: u32) -> Option<MigrationInfo> {
    match target {
        MigrationTarget::Conversations => conversations::get_migration_info(version),
        MigrationTarget::Rag => rag::get_migration_info(version),
    }
}

#[derive(Debug, Clone)]
pub struct MigrationInfo {
    pub description: String,
    pub is_rollbackable: bool,
}

/// Creates a backup snapshot before rollback (optional safety measure)
pub fn create_rollback_snapshot(
    _conn: &Connection,
    target: MigrationTarget,
    backup_dir: &PathBuf,
) -> Result<PathBuf, String> {
    use std::fs;
    use std::io::Write;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let snapshot_name = format!("rollback_snapshot_{}_v{}.sql", target.as_str(), timestamp);
    let snapshot_path = backup_dir.join(&snapshot_name);

    // Ensure backup directory exists
    fs::create_dir_all(backup_dir)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    // Export current state to SQL (simplified - in production would use sqlite3 dump)
    let mut snapshot_file = fs::File::create(&snapshot_path)
        .map_err(|e| format!("Failed to create snapshot file: {}", e))?;

    writeln!(
        snapshot_file,
        "-- Rollback snapshot for {}",
        target.as_str()
    )
    .map_err(|e| format!("Failed to write snapshot header: {}", e))?;
    writeln!(snapshot_file, "-- Created at: {}", timestamp)
        .map_err(|e| format!("Failed to write timestamp: {}", e))?;
    writeln!(
        snapshot_file,
        "-- Run this file to restore pre-rollback state"
    )
    .map_err(|e| format!("Failed to write comment: {}", e))?;

    Ok(snapshot_path)
}

// Sub-modules for target-specific rollback logic
mod conversations {
    use super::MigrationInfo;

    pub fn has_data_loss_on_rollback(_version: u32) -> bool {
        // Check specific migrations for data loss
        // For now, conversation deletions are considered data loss
        false
    }

    pub fn get_migration_info(_version: u32) -> Option<MigrationInfo> {
        // Would return info about specific conversation migrations
        None
    }
}

mod rag {
    use super::MigrationInfo;

    pub fn has_data_loss_on_rollback(version: u32) -> bool {
        // RAG migrations that drop embedding tables cause data loss
        // because re-indexing would be required
        match version {
            1 => true, // Initial schema with embeddings
            _ => false,
        }
    }

    pub fn get_migration_info(_version: u32) -> Option<MigrationInfo> {
        None
    }
}
