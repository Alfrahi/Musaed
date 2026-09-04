//! Runtime wiring test for the migration IPC commands.
//!
//! The commands declare `State<'_, Arc<Mutex<ConversationStore>>>`. This test
//! manages exactly that type in a mock Tauri app and invokes the command
//! bodies, proving the state the commands request is the state the app
//! provides (regression: commands previously requested
//! `Arc<Mutex<rusqlite::Connection>>`, which is never managed → every call
//! failed at runtime with "state not managed").

use musaed_lib::conversation::store::ConversationStore;
use musaed_lib::migrations::{
    cmd_get_migration_status, cmd_run_migrations, rollback_migrations_impl,
};
use std::sync::Arc;
use tauri::Manager;
use tempfile::TempDir;
use tokio::sync::Mutex;

fn managed_store(
    tmp: &TempDir,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    Arc<Mutex<ConversationStore>>,
) {
    let db_path = tmp.path().join("conversations.sqlite3");
    let store = Arc::new(Mutex::new(
        ConversationStore::new(&db_path).expect("Failed to create conversation store"),
    ));
    let app = tauri::test::mock_app();
    app.handle().manage(store.clone());
    (app, store)
}

#[tokio::test]
async fn cmd_run_migrations_executes_against_managed_state() {
    let tmp = TempDir::new().unwrap();
    let (app, _store) = managed_store(&tmp);

    let state = app.state::<Arc<Mutex<ConversationStore>>>();
    let resp = cmd_run_migrations(state, "conversations".into(), None, true)
        .await
        .expect("command must execute");

    assert!(resp.success, "run_migrations response: {:?}", resp.error);
}

#[tokio::test]
async fn cmd_get_migration_status_executes_against_managed_state() {
    let tmp = TempDir::new().unwrap();
    let (app, _store) = managed_store(&tmp);

    let state = app.state::<Arc<Mutex<ConversationStore>>>();
    let resp = cmd_get_migration_status(state, "conversations".into())
        .await
        .expect("command must execute");

    assert!(resp.success, "status response: {:?}", resp.error);
    let status = resp.data.expect("status data");
    assert_eq!(status.current_version, status.latest_version);
    assert!(!status.needs_migration);
}

#[tokio::test]
async fn cmd_rollback_migrations_executes_against_managed_state() {
    let tmp = TempDir::new().unwrap();
    let (app, store) = managed_store(&tmp);

    let resp = rollback_migrations_impl(store, "main", "conversations".into(), 4).await;

    assert!(resp.success, "rollback response: {:?}", resp.error);
    assert_eq!(resp.data.expect("rollback data").to_version, 4);
    drop(app);
}
