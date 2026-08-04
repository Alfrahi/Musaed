use musaed_lib::conversation::service;
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
        prompt_eval_count: None,
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
            prompt_eval_count: None,
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
        prompt_eval_count: None,
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
        prompt_eval_count: None,
        total_duration: None,
        eval_duration: None,
        rag_sources: None,
        error: None,
    };

    let response = service::append_message(store.clone(), "svc-msg".into(), msg).await;
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

    // Should be at least version 2 (with performance indexes)
    assert!(
        version >= 2,
        "Should have run migrations to version 2+, got {}",
        version
    );
}
