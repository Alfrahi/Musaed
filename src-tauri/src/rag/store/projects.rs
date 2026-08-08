//! Project CRUD operations and related business logic.

use super::connection::DEFAULT_EMBEDDING_DIMENSION;
use super::row_mapping::row_to_project;
use crate::rag::error::{RagError, RagResult};
use crate::rag::types::{ProjectStatus, RagProject};
use chrono::Utc;
use rusqlite::OptionalExtension;
use std::path::Path;
use uuid::Uuid;

/// Create a new project record in the database.
pub(super) async fn create_project(store: &super::RagStore, project: &RagProject) -> RagResult<()> {
    let conn = store.write_conn().await;
    conn.execute(
        "INSERT INTO projects (id, name, path, embedding_model, ignore_patterns, created_at, updated_at, indexed_at, file_count, chunk_count, total_bytes, status, embedding_dimension)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            project.id,
            project.name,
            project.path,
            project.embedding_model,
            serde_json::to_string(&project.ignore_patterns)?,
            project.created_at,
            project.updated_at,
            project.indexed_at,
            project.file_count as i64,
            project.chunk_count as i64,
            project.total_bytes as i64,
            project.status.as_str(),
            DEFAULT_EMBEDDING_DIMENSION as i64,
        ],
    )?;
    Ok(())
}

/// Creates a new project from raw parameters, handling ID generation,
/// timestamping, path canonicalization, and assembly.
pub(super) async fn create_project_with_params(
    store: &super::RagStore,
    name: &str,
    path: &str,
    embedding_model: &str,
    ignore_patterns: &[String],
) -> RagResult<RagProject> {
    // Resolve and validate the project path
    let p = Path::new(path);
    let canonical_path = p.canonicalize().map_err(|e| {
        RagError::Config(format!("Path does not exist or is not accessible: {}", e))
    })?;
    if !canonical_path.is_dir() {
        return Err(RagError::Config(format!(
            "Path is not a directory: {:?}",
            canonical_path
        )));
    }
    let canonical_path_str = canonical_path.to_string_lossy().to_string();

    // Generate ID and timestamps
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Assemble project struct
    let project = RagProject {
        id: id.clone(),
        name: name.to_string(),
        path: canonical_path_str,
        embedding_model: embedding_model.to_string(),
        ignore_patterns: ignore_patterns.to_vec(),
        created_at: now.clone(),
        updated_at: now,
        indexed_at: None,
        file_count: 0,
        chunk_count: 0,
        total_bytes: 0,
        status: ProjectStatus::Idle,
    };

    // Persist to database
    create_project(store, &project).await?;

    Ok(project)
}

/// Fetch a single project by ID.
pub(super) async fn get_project(
    store: &super::RagStore,
    id: &str,
) -> RagResult<Option<RagProject>> {
    let conn = store.read_conn().await;
    let mut stmt = conn.prepare("SELECT * FROM projects WHERE id = ?1")?;

    let result = stmt
        .query_row(rusqlite::params![id], row_to_project)
        .optional()?;

    Ok(result)
}

/// List all projects, ordered by most recently updated.
pub(super) async fn list_projects(store: &super::RagStore) -> RagResult<Vec<RagProject>> {
    let conn = store.read_conn().await;
    let mut stmt = conn.prepare("SELECT * FROM projects ORDER BY updated_at DESC")?;

    let projects: Vec<RagProject> = stmt
        .query_map([], row_to_project)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

/// Delete a project and all its associated data.
pub(super) async fn delete_project(store: &super::RagStore, id: &str) -> RagResult<()> {
    let conn = store.write_conn().await;

    // Delete embeddings using subquery
    conn.execute(
        "DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM chunks WHERE project_id = ?1)",
        rusqlite::params![id],
    )?;

    // CASCADE will handle chunks and files
    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;

    Ok(())
}

/// Update project name and/or ignore patterns.
pub(super) async fn update_project_metadata(
    store: &super::RagStore,
    id: &str,
    name: Option<&str>,
    ignore_patterns: Option<&[String]>,
) -> RagResult<()> {
    let conn = store.write_conn().await;
    let now = Utc::now().to_rfc3339();

    if let Some(n) = name {
        conn.execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![n, now, id],
        )?;
    }

    if let Some(patterns) = ignore_patterns {
        let patterns_json = serde_json::to_string(patterns)?;
        conn.execute(
            "UPDATE projects SET ignore_patterns = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![patterns_json, now, id],
        )?;
    }

    Ok(())
}

/// Update project statistics (file count, chunk count, total bytes, indexed timestamp).
pub(super) async fn update_project_stats(
    store: &super::RagStore,
    id: &str,
    file_count: u64,
    chunk_count: u64,
    total_bytes: u64,
    indexed_at: Option<&str>,
) -> RagResult<()> {
    let conn = store.write_conn().await;
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE projects SET file_count = ?1, chunk_count = ?2, total_bytes = ?3, indexed_at = ?4, updated_at = ?5 WHERE id = ?6",
        rusqlite::params![file_count as i64, chunk_count as i64, total_bytes as i64, indexed_at, now, id],
    )?;

    Ok(())
}

/// Get the embedding dimension for a project.
pub(super) async fn get_embedding_dimension(store: &super::RagStore, id: &str) -> RagResult<usize> {
    let conn = store.read_conn().await;
    let dimension: i64 = conn.query_row(
        "SELECT embedding_dimension FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )?;
    Ok(dimension as usize)
}

/// Set the embedding dimension for a project.
pub(super) async fn set_embedding_dimension(
    store: &super::RagStore,
    id: &str,
    dimension: usize,
) -> RagResult<()> {
    let conn = store.write_conn().await;
    conn.execute(
        "UPDATE projects SET embedding_dimension = ?1 WHERE id = ?2",
        rusqlite::params![dimension as i64, id],
    )?;
    Ok(())
}

/// Set the project status (idle, indexing, ready, error).
pub(super) async fn set_status(
    store: &super::RagStore,
    id: &str,
    status: &ProjectStatus,
) -> RagResult<()> {
    let conn = store.write_conn().await;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![status.as_str(), now, id],
    )?;
    Ok(())
}

/// Update the embedding model for a project.
pub(super) async fn update_embedding_model(
    store: &super::RagStore,
    id: &str,
    model: &str,
) -> RagResult<()> {
    let conn = store.write_conn().await;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET embedding_model = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![model, now, id],
    )?;
    Ok(())
}
