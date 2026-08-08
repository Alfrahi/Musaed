use crate::conversation::connection::open_connection;
use crate::conversation::models::{Conversation, Message, MessageError, MessageSearchResult};
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

    pub async fn delete_message(&self, conversation_id: &str, message_id: &str) -> SqlResult<()> {
        let conn = self.lock_conn().await;
        conn.execute(
            "DELETE FROM messages WHERE id = ?1 AND conversation_id = ?2",
            params![message_id, conversation_id],
        )?;
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
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
                 content = excluded.content,
                 done = excluded.done,
                 eval_count = excluded.eval_count,
                 prompt_eval_count = excluded.prompt_eval_count,
                 total_duration = excluded.total_duration,
                 eval_duration = excluded.eval_duration,
                 rag_sources = excluded.rag_sources,
                 error = excluded.error",
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

    /// Search messages across all conversations using SQL LIKE on content.
    /// Returns results grouped by conversation, ordered by most recent match.
    ///
    /// The `query` is treated as a literal substring: `%` and `_` characters
    /// in the query are escaped (with `\`) so they match literally rather than
    /// acting as SQL LIKE wildcards. The `\` escape character itself is also
    /// escaped. The pattern is then wrapped in `%...%` for substring matching.
    pub async fn search_messages(
        &self,
        query: &str,
        limit: usize,
    ) -> SqlResult<Vec<MessageSearchResult>> {
        let conn = self.lock_conn().await;
        // Escape LIKE pattern metacharacters so the user query is matched
        // literally. Order matters: backslash must be escaped first so we
        // don't double-escape the escape characters we add for `%` and `_`.
        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like_pattern = format!("%{}%", escaped);
        let limit_i64 = limit as i64;

        let mut stmt = conn.prepare(
            "SELECT m.id, m.role, m.content, m.timestamp, m.model, m.done,
                    m.request_id, m.images, m.eval_count, m.prompt_eval_count,
                    m.total_duration, m.eval_duration, m.rag_sources, m.error,
                    c.id AS conv_id, c.title AS conv_title
             FROM messages m
             JOIN conversations c ON m.conversation_id = c.id
             WHERE m.content LIKE ?1 ESCAPE '\\'
             ORDER BY m.timestamp DESC
             LIMIT ?2",
        )?;

        let results = stmt
            .query_map(params![like_pattern, limit_i64], |row| {
                Ok(MessageSearchResult {
                    message: Message {
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
                    },
                    conversation_id: row.get(14)?,
                    conversation_title: row.get(15)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::models::{ChatSettings, Conversation, Message};
    use tempfile::tempdir;

    /// Build a `ConversationStore` backed by a fresh temp-directory SQLite DB.
    async fn make_store() -> ConversationStore {
        let dir = tempdir().unwrap();
        ConversationStore::new(&dir.path().join("test.sqlite3")).unwrap()
    }

    /// Helper: insert a conversation + one message into the store.
    async fn seed_message(
        store: &ConversationStore,
        conv_id: &str,
        conv_title: &str,
        msg_id: &str,
        role: &str,
        content: &str,
        timestamp: i64,
    ) {
        let conv = Conversation {
            id: conv_id.to_string(),
            title: conv_title.to_string(),
            model: "test-model".to_string(),
            settings: ChatSettings::default(),
            created_at: timestamp,
            updated_at: timestamp,
            messages: vec![],
        };
        store.create_conversation(&conv).await.unwrap();
        let msg = Message {
            id: msg_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            images: None,
            timestamp,
            model: None,
            done: None,
            request_id: None,
            eval_count: None,
            prompt_eval_count: None,
            total_duration: None,
            eval_duration: None,
            rag_sources: None,
            error: None,
        };
        store.add_message(conv_id, &msg).await.unwrap();
    }

    #[tokio::test]
    async fn test_search_returns_matching_messages() {
        let store = make_store().await;
        seed_message(
            &store,
            "conv-1",
            "First Chat",
            "msg-1",
            "user",
            "What is the capital of France?",
            1000,
        )
        .await;
        seed_message(
            &store,
            "conv-2",
            "Second Chat",
            "msg-2",
            "assistant",
            "The capital of France is Paris.",
            2000,
        )
        .await;

        let results = store.search_messages("France", 50).await.unwrap();
        assert_eq!(results.len(), 2);
        // Ordered by timestamp DESC — most recent first.
        assert_eq!(results[0].message.id, "msg-2");
        assert_eq!(results[0].conversation_id, "conv-2");
        assert_eq!(results[0].conversation_title, "Second Chat");
        assert_eq!(results[1].message.id, "msg-1");
        assert_eq!(results[1].conversation_title, "First Chat");
    }

    #[tokio::test]
    async fn test_search_returns_empty_when_no_match() {
        let store = make_store().await;
        seed_message(
            &store,
            "conv-1",
            "Chat",
            "msg-1",
            "user",
            "Hello world",
            1000,
        )
        .await;

        let results = store.search_messages("nonexistent term", 50).await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_search_respects_limit() {
        let store = make_store().await;
        // Seed 5 messages across 5 conversations, all matching "alpha".
        for i in 0..5 {
            let ts = (i as i64) * 1000;
            seed_message(
                &store,
                &format!("conv-{i}"),
                &format!("Chat {i}"),
                &format!("msg-{i}"),
                "user",
                "alpha content",
                ts,
            )
            .await;
        }

        let results = store.search_messages("alpha", 3).await.unwrap();
        assert_eq!(results.len(), 3);
        // Most recent 3 (timestamps 4000, 3000, 2000).
        assert_eq!(results[0].message.id, "msg-4");
        assert_eq!(results[1].message.id, "msg-3");
        assert_eq!(results[2].message.id, "msg-2");
    }

    #[tokio::test]
    async fn test_search_matches_case_insensitively() {
        let store = make_store().await;
        seed_message(
            &store,
            "conv-1",
            "Chat",
            "msg-1",
            "user",
            "The Quick Brown Fox",
            1000,
        )
        .await;

        // SQL LIKE is case-insensitive for ASCII by default.
        let results = store.search_messages("quick brown", 50).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message.id, "msg-1");
    }

    #[tokio::test]
    async fn test_search_escapes_percent_wildcard() {
        let store = make_store().await;
        // Message containing a literal percent sign.
        seed_message(
            &store,
            "conv-1",
            "Sales Chat",
            "msg-1",
            "assistant",
            "Revenue growth was 50% this quarter.",
            1000,
        )
        .await;
        // Message without a percent sign.
        seed_message(
            &store,
            "conv-2",
            "Other Chat",
            "msg-2",
            "user",
            "No special characters here",
            2000,
        )
        .await;

        // Searching for the literal "50%" should match ONLY the first message
        // — if `%` were not escaped, LIKE would treat it as a wildcard and
        // match any content containing "50" followed by anything.
        let results = store.search_messages("50%", 50).await.unwrap();
        assert_eq!(results.len(), 1, "should match only the percent message");
        assert_eq!(results[0].message.id, "msg-1");
    }

    #[tokio::test]
    async fn test_search_escapes_underscore_wildcard() {
        let store = make_store().await;
        // Message containing a literal underscore.
        seed_message(
            &store,
            "conv-1",
            "Code Chat",
            "msg-1",
            "user",
            "The variable is named my_var in the code.",
            1000,
        )
        .await;
        // A different message that contains "myXvar" (no underscore) —
        // should NOT match "my_var" if `_` is escaped. Without escaping,
        // `_` matches any single character, so "myXvar" would match.
        seed_message(
            &store,
            "conv-2",
            "Other Chat",
            "msg-2",
            "assistant",
            "The value is myXvar here.",
            2000,
        )
        .await;

        let results = store.search_messages("my_var", 50).await.unwrap();
        assert_eq!(results.len(), 1, "underscore should match literally");
        assert_eq!(results[0].message.id, "msg-1");
    }

    #[tokio::test]
    async fn test_search_escapes_backslash() {
        let store = make_store().await;
        // Message containing a literal backslash.
        seed_message(
            &store,
            "conv-1",
            "Path Chat",
            "msg-1",
            "user",
            "Windows path C:\\Users\\test in the logs.",
            1000,
        )
        .await;

        // Searching for the literal backslash sequence should find it.
        let results = store.search_messages("C:\\Users", 50).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message.id, "msg-1");
    }
}
