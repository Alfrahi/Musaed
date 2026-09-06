//! IPC payload types (shared request/response DTOs).
//!
//! Split into per-domain modules; this barrel re-exports everything so
//! existing `crate::payloads::X` imports are unchanged.

mod chat;
mod envelope;
mod models;
mod stream;

pub use chat::*;
pub use envelope::*;
pub use models::*;
pub use stream::*;

#[cfg(test)]
mod tests;
