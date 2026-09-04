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
    completion_tokens INTEGER,
    prompt_tokens INTEGER,
    total_tokens INTEGER,
    total_duration INTEGER,
    eval_duration INTEGER,
    rag_sources TEXT,
    error TEXT,
    CONSTRAINT fk_conversation FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);

-- Full-text search over message content. External-content FTS5 table keyed by
-- messages.rowid, kept in sync by the triggers below. The trigram tokenizer
-- gives substring matching (equivalent to the old LIKE '%...%' semantics)
-- without a full table scan. Gated by migration v6 in
-- migrations/conversations/mod.rs — both places must stay in sync.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid',
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
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
