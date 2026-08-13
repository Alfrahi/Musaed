//! Database connection management, schema, and migrations for conversations.

use crate::migrations::{self, MigrationTarget};
use rusqlite::Connection;
use std::path::Path;

/// Initial schema for conversations database (v1)
pub(super) const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    model TEXT,
    done INTEGER,
    request_id TEXT,
    images TEXT,
    eval_count INTEGER,
    prompt_eval_count INTEGER,
    total_duration INTEGER,
    eval_duration INTEGER,
    rag_sources TEXT,
    error TEXT,
    CONSTRAINT fk_conversation FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
"#;

/// Database pragmas
pub(super) const PRAGMAS_SQL: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
"#;

/// Open (or create) the conversations SQLite database at the given path.
/// The parent directory must already exist.
pub(super) fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open conversations database: {}", e))?;

    // Apply pragmas
    conn.execute_batch(PRAGMAS_SQL)
        .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    // Create schema (full current schema for fresh databases)
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to create conversations schema: {}", e))?;

    // Run migrations through the canonical framework
    migrations::run_migrations_sync(&mut conn, MigrationTarget::Conversations)
        .map_err(|e| format!("Failed to run conversations migrations: {}", e))?;

    Ok(conn)
}
