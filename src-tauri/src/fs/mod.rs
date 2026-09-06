//! Filesystem domain: user-granted path registry and file read/write logic.
//!
//! `service` holds the `FsAccessGrants` registry and the grant-gated I/O
//! implementation (STANDARDS §16); `commands` holds the thin `cmd_fs_*`
//! Tauri adapters.

pub mod commands;
pub mod service;

pub use service::FsAccessGrants;
