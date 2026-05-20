use musaed_lib::conversation::{
    models::{Conversation, Message},
    store::ConversationStore,
};
use std::path::PathBuf;

fn get_test_store() -> ConversationStore {
    // Use in‑memory SQLite for tests
    let db_path = PathBuf::from(":memory:");
    ConversationStore::new(&db_path).expect("Failed to create store")
}

#[test]
fn test_create_and_fetch_conversation() {
    let store = get_test_store();
    let conv = Conversation {
        id: "test1".into(),
        title: "Test Conversation".into(),
        model: "test-model".into(),
        settings: serde_json::json!({}),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).expect("Create failed");
    let fetched = store.get_conversation("test1").expect("Fetch failed");
    assert_eq!(fetched.id, conv.id);
    assert_eq!(fetched.title, conv.title);
}

#[test]
fn test_append_message() {
    let store = get_test_store();
    let conv = Conversation {
        id: "c2".into(),
        title: "C2".into(),
        model: "m".into(),
        settings: serde_json::json!({}),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).unwrap();
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
    store.add_message(&conv.id, &msg).expect("Append failed");
    let conv_with_msgs = store
        .get_conversation_with_messages(&conv.id)
        .expect("Fetch with msgs");
    assert_eq!(conv_with_msgs.messages.len(), 1);
    assert_eq!(conv_with_msgs.messages[0].content, "Hello");
}

#[test]
fn test_delete_conversation() {
    let store = get_test_store();
    let conv = Conversation {
        id: "del".into(),
        title: "Del".into(),
        model: "m".into(),
        settings: serde_json::json!({}),
        created_at: 0,
        updated_at: 0,
        messages: vec![],
    };
    store.create_conversation(&conv).unwrap();
    store.delete_conversation(&conv.id).expect("Delete failed");
    let res = store.get_conversation(&conv.id);
    assert!(res.is_err(), "Conversation should be gone");
}
