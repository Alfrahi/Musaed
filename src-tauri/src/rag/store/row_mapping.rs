//! Row mapping utilities.

use crate::rag::types::{ProjectStatus, RagProject};
use rusqlite::Row;

pub(super) fn row_to_project(row: &Row<'_>) -> Result<RagProject, rusqlite::Error> {
    let ignore_patterns_str: String = row.get(4)?;
    // Surface deserialization failures instead of silently swallowing them.
    // Previously this was `unwrap_or_default()`, which returned `[]` on
    // corrupted JSON — silently reindexing files the user had explicitly
    // asked to ignore. Now we log the corruption and fall back to an empty
    // list while making the failure observable for diagnostics.
    let ignore_patterns: Vec<String> =
        serde_json::from_str(&ignore_patterns_str).unwrap_or_else(|e| {
            tracing::warn!(
                "Corrupted ignore_patterns JSON in RAG project row; falling back to empty list. \
             Parse error: {}. Raw value: {:?}",
                e,
                ignore_patterns_str
            );
            Vec::new()
        });

    // Read status from the column, falling back to derivation from indexed_at
    let status: ProjectStatus = row
        .get::<_, Option<String>>(11)
        .ok()
        .flatten()
        .and_then(|s| match s.as_str() {
            "indexing" => Some(ProjectStatus::Indexing),
            "ready" => Some(ProjectStatus::Ready),
            "error" => Some(ProjectStatus::Error),
            "idle" => Some(ProjectStatus::Idle),
            _ => None,
        })
        .unwrap_or_else(|| {
            if row.get::<_, Option<String>>(7).ok().flatten().is_some() {
                ProjectStatus::Ready
            } else {
                ProjectStatus::Idle
            }
        });

    Ok(RagProject {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        embedding_model: row.get(3)?,
        ignore_patterns,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        indexed_at: row.get(7)?,
        file_count: row.get::<_, i64>(8)? as u64,
        chunk_count: row.get::<_, i64>(9)? as u64,
        total_bytes: row.get::<_, i64>(10)? as u64,
        status,
    })
}
