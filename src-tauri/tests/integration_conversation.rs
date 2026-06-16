use musaed_lib::conversation::{
    models::{ChatSettings, Conversation, Message},
    store::ConversationStore,
};
use std::path::PathBuf;

fn get_test_store() -> ConversationStore {
    // Use in-memory SQLite for tests
    let db_path = PathBuf::from(":memory:");
    ConversationStore::new(&db_path).expect("Failed to create store")
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
        total_duration: None,
        eval_duration: None,
        rag_sources: None,
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
