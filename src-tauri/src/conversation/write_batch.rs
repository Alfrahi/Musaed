//! Batched writer for message appends.
//!
//! `cmd_message_append` used to take the store lock and write per IPC call,
//! which meant every other conversation command waited behind each append.
//! Writes now go through a bounded channel to a single background task that
//! flushes any pending appends together via `add_message_batch`. Under burst
//! (e.g. assistant streaming) messages arriving in the same flush window are
//! written in one transaction.
//!
//! Each append carries a oneshot ack, so callers still learn the write
//! outcome and a successful response still implies durability — the batching
//! only removes lock contention, it does not make writes fire-and-forget.

use crate::conversation::models::Message;
use crate::conversation::store::ConversationStore;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

/// Bounded channel capacity; senders block (not drop) when the writer is behind.
const CHANNEL_CAPACITY: usize = 100;
const MAX_BATCH: usize = 100;

type AppendAck = oneshot::Sender<Result<(), String>>;

struct AppendJob {
    conversation_id: String,
    message: Message,
    ack: AppendAck,
}

#[derive(Clone)]
pub struct WriteBatcher {
    tx: mpsc::Sender<AppendJob>,
}

impl WriteBatcher {
    pub fn spawn(store: Arc<Mutex<ConversationStore>>) -> Self {
        let (tx, mut rx) = mpsc::channel::<AppendJob>(CHANNEL_CAPACITY);
        tauri::async_runtime::spawn(async move {
            while let Some(first) = rx.recv().await {
                let mut batch = vec![first];
                // Drain whatever else has already queued up; an empty channel
                // flushes immediately so idle appends pay no added latency.
                while batch.len() < MAX_BATCH {
                    match rx.try_recv() {
                        Ok(job) => batch.push(job),
                        Err(_) => break,
                    }
                }
                let items: Vec<(String, Message)> = batch
                    .iter()
                    .map(|job| (job.conversation_id.clone(), job.message.clone()))
                    .collect();
                let result = {
                    let store = store.lock().await;
                    store
                        .add_message_batch(&items)
                        .await
                        .map_err(|e| e.to_string())
                };
                for job in batch {
                    let _ = job.ack.send(result.clone());
                }
            }
        });
        WriteBatcher { tx }
    }

    /// Queue a message for writing and wait for the flush outcome.
    ///
    /// Returns `Err` if the write failed, or if the writer task is gone
    /// (shutdown) — in both cases the message was not persisted.
    pub async fn append(&self, conversation_id: String, message: Message) -> Result<(), String> {
        let (ack, rx) = oneshot::channel();
        self.tx
            .send(AppendJob {
                conversation_id,
                message,
                ack,
            })
            .await
            .map_err(|_| "write batcher is shut down".to_string())?;
        rx.await
            .map_err(|_| "write batcher dropped before ack".to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::models::{ChatSettings, Conversation};

    fn make_store() -> Arc<Mutex<ConversationStore>> {
        Arc::new(Mutex::new(
            ConversationStore::new(std::path::Path::new(":memory:")).unwrap(),
        ))
    }

    fn make_conv(id: &str) -> Conversation {
        Conversation {
            id: id.into(),
            title: "t".into(),
            model: "m".into(),
            settings: ChatSettings::default(),
            created_at: 0,
            updated_at: 0,
            messages: vec![],
        }
    }

    fn make_msg(id: &str, content: &str) -> Message {
        Message {
            id: id.into(),
            role: "user".into(),
            content: content.into(),
            images: None,
            timestamp: 1,
            model: None,
            done: Some(true),
            request_id: None,
            eval_count: None,
            completion_tokens: None,
            prompt_eval_count: None,
            prompt_tokens: None,
            total_tokens: None,
            total_duration: None,
            eval_duration: None,
            rag_sources: None,
            error: None,
        }
    }

    /// A burst of concurrent appends must all be persisted, with each caller
    /// receiving its write outcome.
    #[tokio::test]
    async fn test_burst_appends_are_all_persisted() {
        let store = make_store();
        {
            let guard = store.lock().await;
            guard.create_conversation(&make_conv("c1")).await.unwrap();
        }
        let batcher = WriteBatcher::spawn(store.clone());

        let mut handles = Vec::new();
        for i in 0..50 {
            let batcher = batcher.clone();
            handles.push(tokio::spawn(async move {
                batcher
                    .append("c1".into(), make_msg(&format!("m{i}"), &format!("msg {i}")))
                    .await
            }));
        }
        for handle in handles {
            handle.await.unwrap().unwrap();
        }

        let conv = {
            let guard = store.lock().await;
            guard.get_conversation_with_messages("c1").await.unwrap()
        };
        assert_eq!(conv.messages.len(), 50);
    }

    /// A successful ack must imply durability: immediately after `append`
    /// resolves, the message is visible to readers.
    #[tokio::test]
    async fn test_ack_implies_durability() {
        let store = make_store();
        {
            let guard = store.lock().await;
            guard.create_conversation(&make_conv("c1")).await.unwrap();
        }
        let batcher = WriteBatcher::spawn(store.clone());

        batcher
            .append("c1".into(), make_msg("m1", "hi"))
            .await
            .unwrap();

        let conv = {
            let guard = store.lock().await;
            guard.get_conversation_with_messages("c1").await.unwrap()
        };
        assert_eq!(conv.messages.len(), 1);
        assert_eq!(conv.messages[0].content, "hi");
    }
}
