use crate::conversation::connection::open_connection;
use crate::conversation::models::{Conversation, Message, MessageError};
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::Path;
use tokio::sync::Mutex;

pub struct ConversationStore {
    conn: Mutex<Connection>,
}

impl ConversationStore {
    pub fn new(db_path: &Path) -> Result<Self, String> {
        let conn = open_connection(db_path)?;

        Ok(ConversationStore {
            conn: Mutex::new(conn),
        })
    }

    pub async fn lock_conn(&self) -> tokio::sync::MutexGuard<'_, Connection> {
        self.conn.lock().await
    }

    pub async fn list_conversations(&self) -> SqlResult<Vec<Conversation>> {
        let conn = self.lock_conn().await;
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

    pub async fn get_conversation(&self, id: &str) -> SqlResult<Conversation> {
        let conn = self.lock_conn().await;
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

    pub async fn create_conversation(&self, conv: &Conversation) -> SqlResult<()> {
        let conn = self.lock_conn().await;
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

    pub async fn get_conversation_with_messages(&self, id: &str) -> SqlResult<Conversation> {
        let conn = self.lock_conn().await;
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
                    eval_count, prompt_eval_count, total_duration, eval_duration, rag_sources, error
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
                    prompt_eval_count: row.get(9)?,
                    total_duration: row.get(10)?,
                    eval_duration: row.get(11)?,
                    rag_sources: row
                        .get::<_, Option<String>>(12)?
                        .map(|s| serde_json::from_str(&s).unwrap_or_default()),
                    error: row
                        .get::<_, Option<String>>(13)?
                        .and_then(|s| serde_json::from_str::<MessageError>(&s).ok()),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        conv.messages = msgs;
        Ok(conv)
    }

    pub async fn delete_conversation(&self, id: &str) -> SqlResult<()> {
        let conn = self.lock_conn().await;
        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub async fn clear_all_conversations(&self) -> SqlResult<()> {
        let conn = self.lock_conn().await;
        conn.execute("DELETE FROM messages", params![])?;
        conn.execute("DELETE FROM conversations", params![])?;
        Ok(())
    }

    pub async fn update_conversation(
        &self,
        id: &str,
        title: &str,
        updated_at: i64,
    ) -> SqlResult<()> {
        let conn = self.lock_conn().await;
        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, updated_at, id],
        )?;
        Ok(())
    }

    pub async fn add_message(&self, conversation_id: &str, msg: &Message) -> SqlResult<()> {
        let conn = self.lock_conn().await;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, model, done,
                                  request_id, images, eval_count, prompt_eval_count, total_duration, eval_duration, rag_sources, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
                &msg.prompt_eval_count,
                &msg.total_duration,
                &msg.eval_duration,
                &msg.rag_sources.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
                &msg.error.as_ref().map(|e| serde_json::to_string(e).unwrap_or_default()),
            ],
        )?;
        Ok(())
    }
}
