//! Abort-handle registries mapping request/model/project IDs to cancellation tokens.

use dashmap::DashMap;
use std::sync::Arc;
use std::sync::LazyLock;
use tokio_util::sync::CancellationToken;

/// Map of request_id -> CancellationToken for aborting active chat streams.
pub static ABORT_HANDLES: LazyLock<DashMap<String, Arc<CancellationToken>>> =
    LazyLock::new(DashMap::new);

/// Map of model name -> CancellationToken for aborting active model pulls.
pub static PULL_ABORT_HANDLES: LazyLock<DashMap<String, Arc<CancellationToken>>> =
    LazyLock::new(DashMap::new);

/// Map of project_id -> CancellationToken for aborting active RAG indexing.
pub static RAG_INDEX_ABORT_HANDLES: LazyLock<DashMap<String, Arc<CancellationToken>>> =
    LazyLock::new(DashMap::new);

/// Removes abort-handle entries whose token is already cancelled. A cancelled
/// token means the owning stream has finished or been aborted, so the handle
/// is dead weight — sweeping it prevents a panicked/leaked stream from
/// accumulating entries over a long session (Rust #6).
pub fn sweep_stale_abort_handles() {
    ABORT_HANDLES.retain(|_, token| !token.is_cancelled());
    PULL_ABORT_HANDLES.retain(|_, token| !token.is_cancelled());
    RAG_INDEX_ABORT_HANDLES.retain(|_, token| !token.is_cancelled());
}
