//! Conversation database migrations
//!
//! Manages schema evolution for the conversations SQLite database.

use crate::migrations::MigrationStep;

/// Latest migration version for conversations database
pub const LATEST_VERSION: u32 = 2;

/// Gets the migration step for a specific version
pub fn get_migration(version: u32) -> Option<MigrationStep> {
    match version {
        1 => Some(MigrationStep::new(
            1,
            "Initial schema: conversations and messages tables",
            &[
                "CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )",
                "CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                )",
                "CREATE INDEX IF NOT EXISTS idx_messages_conversation 
                 ON messages(conversation_id)",
            ],
            &[
                "DROP TABLE IF EXISTS messages",
                "DROP TABLE IF EXISTS conversations",
            ],
        )),
        2 => Some(MigrationStep::new(
            2,
            "Add performance indexes",
            &[
                "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
                 ON conversations(updated_at)",
                "CREATE INDEX IF NOT EXISTS idx_messages_timestamp 
                 ON messages(timestamp)",
            ],
            &[
                "DROP INDEX IF EXISTS idx_conversations_updated_at",
                "DROP INDEX IF EXISTS idx_messages_timestamp",
            ],
        )),
        _ => None,
    }
}

/// Lists all available migrations
pub fn list_all() -> Vec<MigrationStep> {
    (1..=LATEST_VERSION).filter_map(get_migration).collect()
}
