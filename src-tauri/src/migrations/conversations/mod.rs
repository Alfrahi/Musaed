//! Conversation database migrations
//!
//! Manages schema evolution for the conversations SQLite database.

use crate::migrations::MigrationStep;

/// Latest migration version for conversations database
pub const LATEST_VERSION: u32 = 5;

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
        3 => Some(MigrationStep::new(
            3,
            "Add model, settings, and message metadata columns",
            &[
                // Add model column to conversations
                "ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT 'llama3.2'",
                // Add settings columns to conversations (stored as JSON)
                "ALTER TABLE conversations ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'",
                // Add message metadata columns
                "ALTER TABLE messages ADD COLUMN images TEXT DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN model TEXT DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN done INTEGER DEFAULT 0",
                "ALTER TABLE messages ADD COLUMN request_id TEXT DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN eval_count INTEGER DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN total_duration INTEGER DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN eval_duration INTEGER DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN rag_sources TEXT DEFAULT NULL",
            ],
            &[
                // Rollback: drop added columns (SQLite >= 3.35 required)
                "ALTER TABLE messages DROP COLUMN images",
                "ALTER TABLE messages DROP COLUMN model",
                "ALTER TABLE messages DROP COLUMN done",
                "ALTER TABLE messages DROP COLUMN request_id",
                "ALTER TABLE messages DROP COLUMN eval_count",
                "ALTER TABLE messages DROP COLUMN total_duration",
                "ALTER TABLE messages DROP COLUMN eval_duration",
                "ALTER TABLE messages DROP COLUMN rag_sources",
                "ALTER TABLE conversations DROP COLUMN model",
                "ALTER TABLE conversations DROP COLUMN settings",
            ],
        )),
        4 => Some(MigrationStep::new(
            4,
            "Add prompt_eval_count column for context-window visualization",
            &["ALTER TABLE messages ADD COLUMN prompt_eval_count INTEGER DEFAULT NULL"],
            &["ALTER TABLE messages DROP COLUMN prompt_eval_count"],
        )),
        5 => Some(MigrationStep::new(
            5,
            "Add semantic token alias columns (completion_tokens, prompt_tokens, total_tokens)",
            &[
                "ALTER TABLE messages ADD COLUMN completion_tokens INTEGER DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER DEFAULT NULL",
                "ALTER TABLE messages ADD COLUMN total_tokens INTEGER DEFAULT NULL",
            ],
            &[
                "ALTER TABLE messages DROP COLUMN completion_tokens",
                "ALTER TABLE messages DROP COLUMN prompt_tokens",
                "ALTER TABLE messages DROP COLUMN total_tokens",
            ],
        )),
        _ => None,
    }
}

/// Lists all available migrations
pub fn list_all() -> Vec<MigrationStep> {
    (1..=LATEST_VERSION).filter_map(get_migration).collect()
}
