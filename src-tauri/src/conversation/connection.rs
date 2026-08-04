//! Database connection management, schema, and migrations for conversations.

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
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open conversations database: {}", e))?;

    // Apply pragmas
    conn.execute_batch(PRAGMAS_SQL)
        .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    // Create schema
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to create conversations schema: {}", e))?;

    // Run migrations
    run_migrations(&conn)?;

    Ok(conn)
}

/// Run database migrations for schema changes across versions.
pub(super) fn run_migrations(conn: &Connection) -> Result<(), String> {
    // Ensure the migration tracking table exists
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _conversations_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| format!("Migration: failed to ensure tracking table: {}", e))?;

    // Check current version from migration tracking table
    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _conversations_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Migration 1: Add performance indexes (v2)
    if current_version < 2 {
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
             ON conversations(updated_at);
             CREATE INDEX IF NOT EXISTS idx_messages_timestamp
             ON messages(timestamp);",
        )
        .map_err(|e| format!("Migration v2: failed to add indexes: {}", e))?;

        // Record migration
        conn.execute(
            "INSERT OR REPLACE INTO _conversations_migrations (version, description, applied_at)
             VALUES (2, 'Add performance indexes', datetime('now'))",
            [],
        )
        .map_err(|e| format!("Migration v2: failed to record: {}", e))?;

        tracing::info!("Migration v2: added performance indexes");
    }

    // Migration 3: Add structured `error` column for assistant-message failure
    // payloads (v3 — UX-UI-AUDIT Prompt 8). Existing rows store NULL, which
    // round-trips into the TypeScript `Message.error === undefined` shape.
    // Idempotent: checks column existence before ALTER to survive partial runs.
    if current_version < 3 {
        let has_error_col: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'error'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_error_col {
            conn.execute_batch("ALTER TABLE messages ADD COLUMN error TEXT;")
                .map_err(|e| format!("Migration v3: failed to add error column: {}", e))?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO _conversations_migrations (version, description, applied_at)
             VALUES (3, 'Add messages.error column', datetime('now'))",
            [],
        )
        .map_err(|e| format!("Migration v3: failed to record: {}", e))?;

        tracing::info!("Migration v3: added messages.error column");
    }

    // Migration 4: Add `prompt_eval_count` column for context-window
    // visualization (UX-UI-AUDIT Prompt 14). Stores the prompt/input token
    // count returned by Ollama's done message. Existing rows store NULL,
    // which round-trips into the TypeScript `Message.promptEvalCount === undefined`
    // shape. Idempotent: checks column existence before ALTER.
    if current_version < 4 {
        let has_prompt_eval_count_col: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'prompt_eval_count'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_prompt_eval_count_col {
            conn.execute_batch("ALTER TABLE messages ADD COLUMN prompt_eval_count INTEGER;")
                .map_err(|e| {
                    format!(
                        "Migration v4: failed to add prompt_eval_count column: {}",
                        e
                    )
                })?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO _conversations_migrations (version, description, applied_at)
             VALUES (4, 'Add messages.prompt_eval_count column', datetime('now'))",
            [],
        )
        .map_err(|e| format!("Migration v4: failed to record: {}", e))?;

        tracing::info!("Migration v4: added messages.prompt_eval_count column");
    }

    Ok(())
}
