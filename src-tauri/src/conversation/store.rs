use crate::conversation::models::{Conversation, Message};
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct ConversationStore {
    conn: Arc<Mutex<Connection>>, // Mutex provides Sync + Send
}

impl ConversationStore {
    pub fn new(db_path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
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
                total_duration INTEGER,
                eval_duration INTEGER,
                rag_sources TEXT,
                CONSTRAINT fk_conversation FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);",
        )?;

        Ok(ConversationStore {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn lock_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("Failed to lock DB connection")
    }

    // Synchronous methods (tauri commands are async wrappers)

    pub fn list_conversations(&self) -> SqlResult<Vec<Conversation>> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, title, model, settings, created_at, updated_at FROM conversations",
        )?;
        let conversations = stmt
            .query_map([], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    model: row.get(2)?,
                    settings: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    messages: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(conversations)
    }

    pub fn get_conversation(&self, id: &str) -> SqlResult<Conversation> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, title, model, settings, created_at, updated_at FROM conversations WHERE id = ?1",
        )?;
        stmt.query_row(params![id], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                model: row.get(2)?,
                settings: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                messages: vec![],
            })
        })
    }

    pub fn create_conversation(&self, conv: &Conversation) -> SqlResult<()> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO conversations (id, title, model, settings, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                &conv.id,
                &conv.title,
                &conv.model,
                &serde_json::to_string(&conv.settings).unwrap_or_default(),
                conv.created_at,
                conv.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_conversation_with_messages(&self, id: &str) -> SqlResult<Conversation> {
        let conn = self.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT id, title, model, settings, created_at, updated_at FROM conversations WHERE id = ?1",
        )?;
        let mut conv = stmt.query_row(params![id], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                model: row.get(2)?,
                settings: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                messages: vec![],
            })
        })?;

        let mut stmt_msg = conn.prepare(
            "SELECT id, role, content, timestamp, model, done, request_id, images,
                    eval_count, total_duration, eval_duration, rag_sources
             FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC",
        )?;
        let msgs = stmt_msg
            .query_map(params![id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get(3)?,
                    model: row.get(4)?,
                    done: row.get(5)?,
                    request_id: row.get(6)?,
                    images: row
                        .get::<_, Option<String>>(7)?
                        .map(|s| serde_json::from_str(&s).unwrap_or_default()),
                    eval_count: row.get(8)?,
                    total_duration: row.get(9)?,
                    eval_duration: row.get(10)?,
                    rag_sources: row
                        .get::<_, Option<String>>(11)?
                        .map(|s| serde_json::from_str(&s).unwrap_or_default()),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        conv.messages = msgs;
        Ok(conv)
    }

    pub fn delete_conversation(&self, id: &str) -> SqlResult<()> {
        let conn = self.lock_conn();
        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_all_conversations(&self) -> SqlResult<()> {
        let conn = self.lock_conn();
        conn.execute("DELETE FROM messages", params![])?;
        conn.execute("DELETE FROM conversations", params![])?;
        Ok(())
    }

    pub fn update_conversation(&self, id: &str, title: &str, updated_at: i64) -> SqlResult<()> {
        let conn = self.lock_conn();
        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, updated_at, id],
        )?;
        Ok(())
    }

    pub fn add_message(&self, conversation_id: &str, msg: &Message) -> SqlResult<()> {
        let conn = self.lock_conn();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, model, done,
                                  request_id, images, eval_count, total_duration, eval_duration, rag_sources)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                &msg.id,
                conversation_id,
                &msg.role,
                &msg.content,
                &msg.timestamp,
                &msg.model,
                &msg.done,
                &msg.request_id,
                &msg.images.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
                &msg.eval_count,
                &msg.total_duration,
                &msg.eval_duration,
                &msg.rag_sources.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            ],
        )?;
        Ok(())
    }
}
