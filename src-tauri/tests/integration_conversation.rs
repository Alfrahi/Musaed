use musaed_lib::conversation::service;
use musaed_lib::conversation::write_batch::WriteBatcher;
use musaed_lib::conversation::{
    models::{ChatSettings, Conversation, Message, RagSource},
    store::ConversationStore,
};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

fn get_test_store() -> ConversationStore {
    // Use in-memory SQLite for tests
    let db_path = PathBuf::from(":memory:");
    ConversationStore::new(&db_path).expect("Failed to create store")
}

fn get_test_store_arc() -> Arc<Mutex<ConversationStore>> {
    Arc::new(Mutex::new(get_test_store()))
}

#[tokio::test]
async fn test_create_and_fetch_conversation() {
    let store = get_test_store();
    let conv = Conversation {
        id: "test1".into(),
        title: "Test Conversation".into(),
        model: "test-model".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store
        .create_conversation(&conv)
        .await
        .expect("Create failed");
    let fetched = store.get_conversation("test1").await.expect("Fetch failed");
    assert_eq!(fetched.id, conv.id);
    assert_eq!(fetched.title, conv.title);
}

#[tokio::test]
async fn test_append_message() {
    let store = get_test_store();
    let conv = Conversation {
        id: "c2".into(),
        title: "C2".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).await.unwrap();
    let msg = Message {
        id: "m1".into(),
        role: "user".into(),
        content: "Hello".into(),
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
    };
    store
        .add_message(&conv.id, &msg)
        .await
        .expect("Append failed");
    let conv_with_msgs = store
        .get_conversation_with_messages(&conv.id)
        .await
        .expect("Fetch with msgs");
    assert_eq!(conv_with_msgs.messages.len(), 1);
    assert_eq!(conv_with_msgs.messages[0].content, "Hello");
}

#[tokio::test]
async fn test_delete_conversation() {
    let store = get_test_store();
    let conv = Conversation {
        id: "del".into(),
        title: "Del".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).await.unwrap();
    store
        .delete_conversation(&conv.id)
        .await
        .expect("Delete failed");
    let res = store.get_conversation(&conv.id).await;
    assert!(res.is_err(), "Conversation should be gone");
}

#[tokio::test]
async fn test_list_conversations() {
    let store = get_test_store();

    // Create multiple conversations
    let conv1 = Conversation {
        id: "list1".into(),
        title: "First".into(),
        model: "m1".into(),
        settings: ChatSettings::default(),
        created_at: 1000,
        updated_at: 1000,
        messages: vec![],
    };
    let conv2 = Conversation {
        id: "list2".into(),
        title: "Second".into(),
        model: "m2".into(),
        settings: ChatSettings::default(),
        created_at: 2000,
        updated_at: 2000,
        messages: vec![],
    };

    store.create_conversation(&conv1).await.unwrap();
    store.create_conversation(&conv2).await.unwrap();

    let list = store.list_conversations().await.expect("List failed");
    assert_eq!(list.len(), 2);
    assert!(list.iter().any(|c| c.id == "list1"));
    assert!(list.iter().any(|c| c.id == "list2"));
}

#[tokio::test]
async fn test_list_conversations_orders_by_updated_at_desc() {
    // The frontend (useConversationInitialization) selects the conversation at
    // index [0] as the active one on app launch. list_conversations MUST
    // return rows ordered by updated_at DESC so the most-recently-used
    // conversation is first — otherwise the active conversation on launch
    // would be an old one (insertion order), not the latest-used one.
    let store = get_test_store();

    let older = Conversation {
        id: "older".into(),
        title: "Older".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 1000,
        updated_at: 1000,
        messages: vec![],
    };
    let newer = Conversation {
        id: "newer".into(),
        title: "Newer".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 2000,
        updated_at: 2000,
        messages: vec![],
    };
    // Insert older first; newer second. updated_at differs (newer > older).
    // Without ORDER BY, SQLite would return them in rowid/insertion order
    // (older, newer) and the frontend would pick `older` as active.
    store.create_conversation(&older).await.unwrap();
    store.create_conversation(&newer).await.unwrap();

    let list = store.list_conversations().await.expect("List failed");
    assert_eq!(list.len(), 2);
    // Most recently updated first.
    assert_eq!(list[0].id, "newer");
    assert_eq!(list[1].id, "older");
}

#[tokio::test]
async fn test_list_conversations_orders_by_updated_at_desc_after_update() {
    // Updating an older conversation bumps its updated_at; it must move to
    // the front of list_conversations. This pins the "pick latest used on
    // app launch" contract that follows a user working across many old
    // conversations.
    let store = get_test_store();

    let first = Conversation {
        id: "first".into(),
        title: "First".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 1000,
        updated_at: 1000,
        messages: vec![],
    };
    let second = Conversation {
        id: "second".into(),
        title: "Second".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 2000,
        updated_at: 2000,
        messages: vec![],
    };
    store.create_conversation(&first).await.unwrap();
    store.create_conversation(&second).await.unwrap();

    // Before update — second is the most recently updated.
    let list = store.list_conversations().await.unwrap();
    assert_eq!(list[0].id, "second");

    // Update first to have the newest updated_at.
    store
        .update_conversation(&first.id, "First bumped", 3000)
        .await
        .unwrap();

    let list = store.list_conversations().await.unwrap();
    assert_eq!(list[0].id, "first");
    assert_eq!(list[1].id, "second");
}

#[tokio::test]
async fn test_update_conversation() {
    let store = get_test_store();
    let conv = Conversation {
        id: "upd".into(),
        title: "Original".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).await.unwrap();

    store
        .update_conversation(&conv.id, "Updated", 5000)
        .await
        .expect("Update failed");

    let fetched = store.get_conversation("upd").await.expect("Fetch failed");
    assert_eq!(fetched.title, "Updated");
    assert_eq!(fetched.updated_at, 5000);
}

#[tokio::test]
async fn test_clear_all_conversations() {
    let store = get_test_store();

    // Create multiple conversations with messages
    for i in 1..=3 {
        let conv = Conversation {
            id: format!("clear{}", i),
            title: format!("Conv {}", i),
            model: "m".into(),
            settings: ChatSettings::default(),
            created_at: 0,
            updated_at: 0,
            messages: vec![],
        };
        store.create_conversation(&conv).await.unwrap();

        let msg = Message {
            id: format!("msg{}", i),
            role: "user".into(),
            content: "Test".into(),
            images: None,
            timestamp: i as i64,
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
        };
        store.add_message(&conv.id, &msg).await.unwrap();
    }

    store.clear_all_conversations().await.expect("Clear failed");

    let list = store.list_conversations().await.expect("List failed");
    assert_eq!(list.len(), 0);
}

#[tokio::test]
async fn test_message_with_rag_sources() {
    let store = get_test_store();
    let conv = Conversation {
        id: "rag-test".into(),
        title: "RAG Test".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).await.unwrap();

    let rag_sources = Some(vec![RagSource {
        file_path: "src/lib.rs".into(),
        start_line: 10,
        end_line: 20,
        language: Some("rust".into()),
    }]);

    let msg = Message {
        id: "m1".into(),
        role: "assistant".into(),
        content: "Based on the code...".into(),
        images: None,
        timestamp: 1,
        model: Some("m".into()),
        done: Some(true),
        request_id: Some("req1".into()),
        eval_count: Some(100),
        completion_tokens: None,
        prompt_eval_count: None,
        prompt_tokens: None,
        total_tokens: None,
        total_duration: Some(500),
        eval_duration: Some(50),
        rag_sources,
        error: None,
    };

    store.add_message(&conv.id, &msg).await.unwrap();

    let conv_with_msgs = store
        .get_conversation_with_messages(&conv.id)
        .await
        .expect("Fetch failed");

    assert_eq!(conv_with_msgs.messages.len(), 1);
    let retrieved_msg = &conv_with_msgs.messages[0];
    assert!(retrieved_msg.rag_sources.is_some());
    let sources = retrieved_msg.rag_sources.as_ref().unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].file_path, "src/lib.rs");
    assert_eq!(sources[0].start_line, 10);
}

/// Regression test for the assistant-message double-insert race.
///
/// The frontend persists the assistant placeholder immediately (NULL metrics,
/// empty content) and re-persists the same message id when the stream's `done`
/// event arrives (with final content + `eval_count`/`prompt_eval_count`/...).
/// `add_message` MUST upsert on conflict; a plain INSERT would lose metrics
/// on reload because the second insert hits a PRIMARY KEY violation.
#[tokio::test]
async fn test_upsert_message_updates_existing_row() {
    let store = get_test_store();
    let conv = Conversation {
        id: "upsert-conv".into(),
        title: "Upsert".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).await.unwrap();

    // 1) Placeholder insert — empty content, NULL metrics (mimics useChatSend).
    let placeholder = Message {
        id: "msg-upsert".into(),
        role: "assistant".into(),
        content: "".into(),
        images: None,
        timestamp: 1,
        model: Some("m".into()),
        done: Some(false),
        request_id: Some("req-1".into()),
        eval_count: None,
        completion_tokens: None,
        prompt_eval_count: None,
        prompt_tokens: None,
        total_tokens: None,
        total_duration: None,
        eval_duration: None,
        rag_sources: None,
        error: None,
    };
    store
        .add_message(&conv.id, &placeholder)
        .await
        .expect("placeholder insert");

    // 2) Final insert — same id, now with content + metrics (mimics useTauriEvents done).
    let final_msg = Message {
        id: "msg-upsert".into(),
        role: "assistant".into(),
        content: "Hello back".into(),
        images: None,
        timestamp: 1,
        model: Some("m".into()),
        done: Some(true),
        request_id: Some("req-1".into()),
        eval_count: Some(42),
        completion_tokens: None,
        prompt_eval_count: Some(10),
        prompt_tokens: None,
        total_tokens: None,
        total_duration: Some(500),
        eval_duration: Some(50),
        rag_sources: None,
        error: None,
    };
    store
        .add_message(&conv.id, &final_msg)
        .await
        .expect("final upsert should not error");

    // 3) Verify the persisted row carries the FINAL values, not the placeholder.
    let fetched = store
        .get_conversation_with_messages(&conv.id)
        .await
        .expect("fetch");
    assert_eq!(fetched.messages.len(), 1, "should be one row, not two");
    let m = &fetched.messages[0];
    assert_eq!(m.content, "Hello back");
    assert_eq!(m.done, Some(true));
    assert_eq!(m.eval_count, Some(42));
    assert_eq!(m.prompt_eval_count, Some(10));
    assert_eq!(m.total_duration, Some(500));
    assert_eq!(m.eval_duration, Some(50));
}

/// Regression test for the images/request_id/model silent-drop bug.
///
/// The ON CONFLICT(id) DO UPDATE clause previously omitted `images`,
/// `request_id`, and `model`. When the same message id was re-asserted
/// (e.g. `editAndResend` updates a user message's images, or the streaming
/// assistant placeholder is re-persisted with a different model), those
/// fields were silently dropped because the UPDATE path kept the original
/// row's values. The clause must now include every mutable field so that
/// the caller's latest values always win on conflict.
#[tokio::test]
async fn test_upsert_preserves_images_request_id_model_on_update() {
    let store = get_test_store();
    let conv = Conversation {
        id: "upsert-fields".into(),
        title: "Upsert Fields".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).await.unwrap();

    // 1) Initial insert — user message with images and a request_id.
    let initial = Message {
        id: "msg-fields".into(),
        role: "user".into(),
        content: "hello".into(),
        images: Some(vec!["img1.png".into()]),
        timestamp: 1,
        model: None,
        done: None,
        request_id: Some("req-A".into()),
        eval_count: None,
        completion_tokens: None,
        prompt_eval_count: None,
        prompt_tokens: None,
        total_tokens: None,
        total_duration: None,
        eval_duration: None,
        rag_sources: None,
        error: None,
    };
    store
        .add_message(&conv.id, &initial)
        .await
        .expect("initial insert");

    // 2) Re-assert same id with updated images, request_id, and model —
    //    mimics editAndResend changing the message content + attachments.
    let updated = Message {
        id: "msg-fields".into(),
        role: "user".into(),
        content: "hello EDITED".into(),
        images: Some(vec!["img2.png".into(), "img3.png".into()]),
        timestamp: 1,
        model: Some("llama3.2".into()),
        done: Some(true),
        request_id: Some("req-B".into()),
        eval_count: None,
        completion_tokens: None,
        prompt_eval_count: None,
        prompt_tokens: None,
        total_tokens: None,
        total_duration: None,
        eval_duration: None,
        rag_sources: None,
        error: None,
    };
    store
        .add_message(&conv.id, &updated)
        .await
        .expect("upsert should not error");

    // 3) Verify the persisted row carries the UPDATED values.
    let fetched = store
        .get_conversation_with_messages(&conv.id)
        .await
        .expect("fetch");
    assert_eq!(fetched.messages.len(), 1, "should be one row, not two");
    let m = &fetched.messages[0];
    assert_eq!(m.content, "hello EDITED");
    assert_eq!(
        m.request_id,
        Some("req-B".to_string()),
        "request_id must update on conflict"
    );
    assert_eq!(
        m.model,
        Some("llama3.2".to_string()),
        "model must update on conflict"
    );
    assert_eq!(
        m.images,
        Some(vec!["img2.png".to_string(), "img3.png".to_string()]),
        "images must update on conflict",
    );
}

#[tokio::test]
async fn test_service_layer_list() {
    let store = get_test_store_arc();

    let conv = Conversation {
        id: "svc1".into(),
        title: "Service Test".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };

    // Create via store directly
    store.lock().await.create_conversation(&conv).await.unwrap();

    // List via service layer
    let response = service::list_conversations(store.clone()).await;
    assert!(response.success);
    assert!(response.error.is_none());
    let data = response.data.expect("Should have data");
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].title, "Service Test");
}

#[tokio::test]
async fn test_service_layer_create() {
    let store = get_test_store_arc();

    let conv = Conversation {
        id: "svc-create".into(),
        title: "Created via Service".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 12345,
        updated_at: 12345,
        messages: vec![],
    };

    let response = service::create_conversation(store.clone(), conv.clone()).await;
    assert!(response.success);
    assert!(response.error.is_none());
    assert_eq!(response.data, Some("svc-create".to_string()));

    // Verify it was created
    let fetched = service::get_conversation(store, "svc-create".to_string()).await;
    assert!(fetched.success);
    assert_eq!(fetched.data.unwrap().title, "Created via Service");
}

#[tokio::test]
async fn test_service_layer_append_message() {
    let store = get_test_store_arc();

    // Create conversation first
    let conv = Conversation {
        id: "svc-msg".into(),
        title: "Msg Test".into(),
        model: "m".into(),
        settings: ChatSettings::default(),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.lock().await.create_conversation(&conv).await.unwrap();

    let msg = Message {
        id: "msg1".into(),
        role: "user".into(),
        content: "Service message".into(),
        images: None,
        timestamp: 100,
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
    };

    let batcher = WriteBatcher::spawn(store.clone());
    let response = service::append_message(batcher, "svc-msg".into(), msg).await;
    assert!(response.success);
    assert!(response.error.is_none());

    // Verify message was appended
    let fetched = service::get_conversation(store, "svc-msg".into()).await;
    let conv_data = fetched.data.unwrap();
    assert_eq!(conv_data.messages.len(), 1);
    assert_eq!(conv_data.messages[0].content, "Service message");
}

#[tokio::test]
async fn test_migration_tracking_table_exists() {
    let store = get_test_store();

    // Verify the migrations tracking table was created
    let conn = store.lock_conn().await;
    let result: Result<String, _> = conn.query_row(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_conversations_migrations'",
        [],
        |row| row.get(0),
    );
    assert!(result.is_ok(), "Migration tracking table should exist");
}

#[tokio::test]
async fn test_migration_version_recorded() {
    let store = get_test_store();

    // Verify migration version was recorded
    let conn = store.lock_conn().await;
    let version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _conversations_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Should be at the latest version (stamped by canonical migration framework)
    assert!(
        version >= 5,
        "Should have run migrations to version 5+, got {}",
        version
    );
}
