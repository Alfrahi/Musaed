//! Key-value store domain: validation/error mapping + thin command adapters.
//!
//! `service` owns the filename/key/value validation and `ApiResponse` error
//! shapes; `commands` holds the thin `cmd_store_*` Tauri adapters.

pub mod commands;
pub mod service;
