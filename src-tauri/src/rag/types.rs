//! RAG-specific payload types shared between Tauri commands and the frontend.

use serde::{Deserialize, Serialize};

// ====================== PROJECT ======================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RagProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub indexed_at: Option<String>,
    pub file_count: u64,
    pub chunk_count: u64,
    pub total_bytes: u64,
    pub status: ProjectStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    Idle,
    Indexing,
    Ready,
    Error,
}

impl ProjectStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProjectStatus::Idle => "idle",
            ProjectStatus::Indexing => "indexing",
            ProjectStatus::Ready => "ready",
            ProjectStatus::Error => "error",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
}

// ====================== INDEXING ======================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub project_id: String,
    pub phase: IndexPhase,
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IndexPhase {
    DiscoveringFiles,
    DiffingFiles,
    DeletingStale,
    ReadingFiles,
    ChunkingFiles,
    EmbeddingChunks,
    StoringChunks,
    Completed,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub project_id: String,
    pub is_indexing: bool,
    pub progress: Option<IndexProgress>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexComplete {
    pub project_id: String,
    pub indexed_at: String,
    pub file_count: u64,
    pub chunk_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexError {
    pub project_id: String,
    pub message: String,
}

// ====================== SEARCH ======================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub chunk_id: i64,
    pub content: String,
    pub chunk_type: String,
    pub language: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub file_path: String,
    pub score: f32,
    pub metadata: serde_json::Value,
}

// ====================== STATS ======================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub file_count: u64,
    pub chunk_count: u64,
    pub total_bytes: u64,
    pub embedding_dimension: usize,
    pub index_size_bytes: u64,
    pub last_indexed: Option<String>,
}

// ====================== CHUNKS ======================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRecord {
    pub id: i64,
    pub chunk_index: usize,
    pub content: String,
    pub chunk_type: String,
    pub language: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub metadata: serde_json::Value,
}

// ====================== EMBEDDING ======================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbedProgress {
    pub project_id: String,
    pub batch_current: usize,
    pub batch_total: usize,
    pub chunks_embedded: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelValidation {
    pub is_valid: bool,
    pub model_name: String,
    pub embedding_dimension: Option<usize>,
    pub error: Option<String>,
}

// ====================== INTERNAL DB TYPES ======================

/// Internal row representation for the `files` table.
#[derive(Debug, Clone)]
pub struct FileRecord {
    pub id: Option<i64>,
    pub project_id: String,
    pub relative_path: String,
    pub file_hash: String,
    pub file_size: u64,
    pub modified_at: String,
    pub chunk_count: usize,
}

/// Internal row representation for the `chunks` table.
#[derive(Debug, Clone)]
pub struct ChunkRow {
    pub id: Option<i64>,
    pub project_id: String,
    pub file_id: i64,
    pub chunk_index: usize,
    pub content: String,
    pub chunk_type: String,
    pub language: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub metadata: serde_json::Value,
}

/// Raw chunk produced by the chunker before DB insertion.
#[derive(Debug, Clone)]
pub struct RawChunk {
    pub content: String,
    pub chunk_type: ChunkType,
    pub language: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChunkType {
    Code,
    Markdown,
    Text,
    Config,
}

impl ChunkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChunkType::Code => "code",
            ChunkType::Markdown => "markdown",
            ChunkType::Text => "text",
            ChunkType::Config => "config",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_status_serialization() {
        let status = ProjectStatus::Indexing;
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"indexing\""));
        let back: ProjectStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ProjectStatus::Indexing);
    }

    #[test]
    fn rag_project_camel_case() {
        let project = RagProject {
            id: "test-id".to_string(),
            name: "Test".to_string(),
            path: "/test".to_string(),
            embedding_model: "nomic-embed-text-v2-moe".to_string(),
            ignore_patterns: vec![],
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
            indexed_at: None,
            file_count: 0,
            chunk_count: 0,
            total_bytes: 0,
            status: ProjectStatus::Idle,
        };
        let json = serde_json::to_string(&project).unwrap();
        assert!(json.contains("\"embeddingModel\""));
        assert!(json.contains("\"ignorePatterns\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"indexedAt\":null"));
    }

    #[test]
    fn index_phase_roundtrip() {
        let phase = IndexPhase::EmbeddingChunks;
        let json = serde_json::to_string(&phase).unwrap();
        assert!(json.contains("\"embeddingChunks\""));
        let back: IndexPhase = serde_json::from_str(&json).unwrap();
        assert_eq!(back, IndexPhase::EmbeddingChunks);
    }

    #[test]
    fn chunk_type_as_str() {
        assert_eq!(ChunkType::Code.as_str(), "code");
        assert_eq!(ChunkType::Markdown.as_str(), "markdown");
        assert_eq!(ChunkType::Text.as_str(), "text");
        assert_eq!(ChunkType::Config.as_str(), "config");
    }

    #[test]
    fn search_result_serialization() {
        let result = SearchResult {
            chunk_id: 42,
            content: "fn main() {}".to_string(),
            chunk_type: "code".to_string(),
            language: Some("rust".to_string()),
            start_line: 1,
            end_line: 10,
            file_path: "src/main.rs".to_string(),
            score: 0.95,
            metadata: serde_json::json!({}),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"chunkId\":42"));
        assert!(json.contains("\"startLine\":1"));
        assert!(json.contains("\"filePath\":\"src/main.rs\""));
    }
}
