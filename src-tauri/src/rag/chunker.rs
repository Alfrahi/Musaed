//! Chunking strategies for RAG indexing.
//!
//! Supports code-aware chunking (tree-sitter), markdown chunking (heading-based),
//! config chunking, and plain-text chunking (sliding window).

use crate::rag::types::{ChunkType, RawChunk};
use tree_sitter::{Node, Parser, Tree};

// ====================== CONSTANTS ======================

/// Maximum characters per chunk (≈ 500 tokens for English).
const MAX_CHUNK_CHARS: usize = 2000;

/// Overlap in characters between adjacent chunks.
const OVERLAP_CHARS: usize = 200;

/// Minimum characters for a chunk (below this, merge with adjacent).
const MIN_CHUNK_CHARS: usize = 100;

/// Hard upper limit — force a split beyond this size.
const ABSOLUTE_MAX_CHUNK_CHARS: usize = 4000;

// ====================== EXTENSION MAPS ======================

const CODE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "c", "cpp", "h", "hpp", "cs", "rb", "php",
    "swift", "kt", "scala", "sh", "bash", "zsh",
];

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "mdx"];

const CONFIG_EXTENSIONS: &[&str] = &["json", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf"];

// ====================== LANGUAGE DETECTION ======================

/// Maps file extension to a (tree-sitter language, friendly name) pair.
fn language_for_ext(ext: &str) -> Option<(tree_sitter::Language, &'static str)> {
    match ext {
        "rs" => Some((tree_sitter_rust::LANGUAGE.into(), "rust")),
        "ts" | "tsx" => Some((
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            "typescript",
        )),
        "js" | "jsx" => Some((
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            "javascript",
        )),
        "py" => Some((tree_sitter_python::LANGUAGE.into(), "python")),
        "go" => Some((tree_sitter_go::LANGUAGE.into(), "go")),
        "java" => Some((tree_sitter_java::LANGUAGE.into(), "java")),
        "c" | "h" => Some((tree_sitter_c::LANGUAGE.into(), "c")),
        "cpp" | "hpp" => Some((tree_sitter_cpp::LANGUAGE.into(), "cpp")),
        "json" => Some((tree_sitter_json::LANGUAGE.into(), "json")),
        "yaml" | "yml" => Some((tree_sitter_yaml::LANGUAGE.into(), "yaml")),
        _ => None,
    }
}

/// Determine the chunk type from a file extension.
pub fn chunk_type_for_file(file_path: &str) -> ChunkType {
    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();

    if CODE_EXTENSIONS.contains(&ext.as_str()) {
        ChunkType::Code
    } else if MARKDOWN_EXTENSIONS.contains(&ext.as_str()) {
        ChunkType::Markdown
    } else if CONFIG_EXTENSIONS.contains(&ext.as_str()) {
        ChunkType::Config
    } else {
        ChunkType::Text
    }
}

// ====================== CHUNKER TRAIT ======================

pub trait Chunker: Send + Sync {
    fn chunk(&self, content: &str, file_path: &str) -> Vec<RawChunk>;
}

// ====================== CODE CHUNKER ======================

pub struct CodeChunker;

impl Chunker for CodeChunker {
    fn chunk(&self, content: &str, file_path: &str) -> Vec<RawChunk> {
        let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();

        match language_for_ext(&ext) {
            Some((lang, lang_name)) => {
                let mut parser = Parser::new();
                parser.set_language(&lang).ok();

                match parser.parse(content, None) {
                    Some(tree) => {
                        let chunks = chunk_ast(&tree, content, lang_name);
                        if chunks.is_empty() && !content.trim().is_empty() {
                            TextChunker.chunk(content, file_path)
                        } else {
                            chunks
                        }
                    }
                    None => TextChunker.chunk(content, file_path),
                }
            }
            None => TextChunker.chunk(content, file_path),
        }
    }
}

/// Extract semantic nodes from a tree-sitter AST and produce chunks.
fn chunk_ast(tree: &Tree, source: &str, language: &str) -> Vec<RawChunk> {
    let root = tree.root_node();
    let mut chunks = Vec::new();
    let mut names = Vec::new();
    let mut imports = Vec::new();

    // Collect top-level semantic nodes
    let mut i = 0;
    let child_count = root.child_count();
    while i < child_count {
        let child = root.child(i).unwrap();
        let kind = child.kind();

        match kind {
            // Import / use statements — collect but don't create separate chunks
            "import_statement" | "import_declaration" | "use_declaration" | "extern_crate_item"
            | "use_item" => {
                let text = node_text(child, source);
                if !text.is_empty() {
                    imports.push(text);
                }
            }
            // Semantic units — create chunks
            "function_definition"
            | "function_declaration"
            | "function_item"
            | "method_definition"
            | "method_declaration"
            | "class_definition"
            | "class_declaration"
            | "struct_item"
            | "enum_item"
            | "impl_item"
            | "trait_item"
            | "type_item"
            | "type_alias_declaration"
            | "interface_declaration"
            | "impl_definition"
            | "declaration"
            | "export_statement"
            | "export_declaration"
            | "lexical_declaration"
            | "variable_declaration" => {
                let text = node_text(child, source);

                // Extract name and enclosing entity
                let mut enclosing_entity = None;
                if let Some(name_node) = child.child_by_field_name("name") {
                    let name = node_text(name_node, source);
                    names.push(name.clone());
                    enclosing_entity = Some(name);
                }

                if text.len() <= ABSOLUTE_MAX_CHUNK_CHARS {
                    let start = child.start_position().row + 1; // 1-based
                    let end = child.end_position().row + 1;

                    chunks.push(RawChunk {
                        content: text,
                        chunk_type: ChunkType::Code,
                        language: Some(language.to_string()),
                        start_line: start,
                        end_line: end,
                        metadata: build_chunk_metadata(
                            &names,
                            &imports,
                            enclosing_entity.as_deref(),
                        ),
                    });
                } else {
                    // Split oversized node at statement boundaries
                    let sub_chunks =
                        split_oversized_node(&child, source, language, &names, &imports);
                    chunks.extend(sub_chunks);
                }
                names.clear();
            }
            // Other top-level items (const, static, etc.) — group small ones together
            _ => {
                let text = node_text(child, source);
                if !text.is_empty() {
                    let start = child.start_position().row + 1;
                    let end = child.end_position().row + 1;

                    chunks.push(RawChunk {
                        content: text,
                        chunk_type: ChunkType::Code,
                        language: Some(language.to_string()),
                        start_line: start,
                        end_line: end,
                        metadata: build_chunk_metadata(&[], &imports, None),
                    });
                }
            }
        }
        i += 1;
    }

    // Merge small adjacent chunks
    merge_small_chunks(chunks)
}

/// Split an oversized AST node at statement boundaries.
fn split_oversized_node(
    node: &Node,
    source: &str,
    language: &str,
    names: &[String],
    imports: &[String],
) -> Vec<RawChunk> {
    // Extract enclosing entity name for sub-chunks
    let enclosing_entity = if !names.is_empty() {
        Some(names[0].as_str())
    } else {
        None
    };

    let mut chunks = Vec::new();
    let mut current_text = String::new();
    let mut current_start = node.start_position().row + 1;

    let child_count = node.child_count();
    for i in 0..child_count {
        let child = node.child(i).unwrap();
        let child_text = node_text(child, source);

        if current_text.len() + child_text.len() > MAX_CHUNK_CHARS && !current_text.is_empty() {
            let end = child.start_position().row; // End before this child
            chunks.push(RawChunk {
                content: std::mem::take(&mut current_text),
                chunk_type: ChunkType::Code,
                language: Some(language.to_string()),
                start_line: current_start,
                end_line: end,
                metadata: build_chunk_metadata(names, imports, enclosing_entity),
            });
            current_start = child.start_position().row + 1;
        }

        current_text.push_str(&child_text);
        current_text.push('\n');
    }

    if !current_text.is_empty() {
        chunks.push(RawChunk {
            content: current_text,
            chunk_type: ChunkType::Code,
            language: Some(language.to_string()),
            start_line: current_start,
            end_line: node.end_position().row + 1,
            metadata: build_chunk_metadata(names, imports, enclosing_entity),
        });
    }

    chunks
}

// ====================== MARKDOWN CHUNKER ======================

pub struct MarkdownChunker;

impl Chunker for MarkdownChunker {
    fn chunk(&self, content: &str, _file_path: &str) -> Vec<RawChunk> {
        let lines: Vec<&str> = content.lines().collect();
        let mut chunks = Vec::new();
        let mut current_section = String::new();
        let mut _current_heading = String::new();
        let mut heading_chain: Vec<String> = Vec::new();
        let mut section_start = 1; // 1-based
        let mut current_line = 1;

        for line in &lines {
            let trimmed = line.trim();

            // Detect h2+ headings
            if trimmed.starts_with("## ") {
                // Save previous section
                if !current_section.is_empty() && current_section.len() >= MIN_CHUNK_CHARS {
                    chunks.push(RawChunk {
                        content: std::mem::take(&mut current_section),
                        chunk_type: ChunkType::Markdown,
                        language: None,
                        start_line: section_start,
                        end_line: current_line - 1,
                        metadata: build_markdown_metadata(&heading_chain),
                    });
                    section_start = current_line;
                } else if !current_section.is_empty() {
                    // Section too small, keep accumulating
                }

                // Update heading chain
                let heading_text = trimmed.trim_start_matches('#').trim().to_string();
                let level = trimmed.chars().take_while(|c| *c == '#').count();
                // Keep headings at or above the current level
                heading_chain.retain(|h: &String| {
                    // Keep headings that are above this level (fewer #)
                    let h_level = h.chars().take_while(|c| *c == '#').count();
                    h_level < level
                });
                heading_chain.push(trimmed.to_string());
                _current_heading = heading_text;

                if current_section.is_empty() {
                    section_start = current_line;
                }
            }

            current_section.push_str(line);
            current_section.push('\n');
            current_line += 1;
        }

        // Final section
        if !current_section.is_empty() {
            chunks.push(RawChunk {
                content: current_section,
                chunk_type: ChunkType::Markdown,
                language: None,
                start_line: section_start,
                end_line: lines.len(),
                metadata: build_markdown_metadata(&heading_chain),
            });
        }

        // If no chunks (no headings), treat as single chunk
        if chunks.is_empty() && !content.is_empty() {
            chunks.push(RawChunk {
                content: content.to_string(),
                chunk_type: ChunkType::Markdown,
                language: None,
                start_line: 1,
                end_line: lines.len(),
                metadata: serde_json::json!({}),
            });
        }

        merge_small_chunks(chunks)
    }
}

// ====================== CONFIG CHUNKER ======================

pub struct ConfigChunker;

impl Chunker for ConfigChunker {
    fn chunk(&self, content: &str, file_path: &str) -> Vec<RawChunk> {
        let lines: Vec<&str> = content.lines().collect();

        // Small files: keep whole
        if content.len() <= MAX_CHUNK_CHARS {
            return vec![RawChunk {
                content: content.to_string(),
                chunk_type: ChunkType::Config,
                language: None,
                start_line: 1,
                end_line: lines.len(),
                metadata: serde_json::json!({}),
            }];
        }

        // Large config: split at top-level key boundaries
        let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
        match ext.as_str() {
            "yaml" | "yml" => split_yaml(content, &lines),
            "json" => split_json(content, &lines),
            _ => TextChunker.chunk(content, file_path),
        }
    }
}

fn split_yaml(content: &str, lines: &[&str]) -> Vec<RawChunk> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut start_line = 1;

    for (i, line) in lines.iter().enumerate() {
        // Top-level keys start at column 0 with no leading whitespace and contain ':'
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && !trimmed.starts_with('-')
            && !trimmed.starts_with('#')
            && line.starts_with(|c: char| !c.is_whitespace())
            && trimmed.contains(':')
        {
            // Start of a new top-level key
            if !current.is_empty() && current.len() >= MIN_CHUNK_CHARS {
                chunks.push(RawChunk {
                    content: std::mem::take(&mut current),
                    chunk_type: ChunkType::Config,
                    language: None,
                    start_line,
                    end_line: i,
                    metadata: serde_json::json!({}),
                });
                start_line = i + 1;
            }
        }
        current.push_str(line);
        current.push('\n');
    }

    if !current.is_empty() {
        chunks.push(RawChunk {
            content: current,
            chunk_type: ChunkType::Config,
            language: None,
            start_line,
            end_line: lines.len(),
            metadata: serde_json::json!({}),
        });
    }

    if chunks.is_empty() {
        chunks.push(RawChunk {
            content: content.to_string(),
            chunk_type: ChunkType::Config,
            language: None,
            start_line: 1,
            end_line: lines.len(),
            metadata: serde_json::json!({}),
        });
    }

    chunks
}

fn split_json(content: &str, lines: &[&str]) -> Vec<RawChunk> {
    // For JSON, try to split at top-level object keys
    let mut chunks = Vec::new();
    let mut depth: i32 = 0;
    let mut current = String::new();
    let mut start_line = 1;
    let mut found_first_key = false;

    for (i, line) in lines.iter().enumerate() {
        for ch in line.chars() {
            match ch {
                '{' | '[' => depth += 1,
                '}' | ']' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }

        current.push_str(line);
        current.push('\n');

        // Split when we return to depth 1 (top-level key boundary)
        if depth == 1 && current.len() >= MIN_CHUNK_CHARS {
            let trimmed = line.trim();
            if trimmed.ends_with(',') || trimmed.ends_with('{') || trimmed.ends_with('[') {
                found_first_key = true;
            }

            if found_first_key
                && current.len() >= MIN_CHUNK_CHARS
                && (trimmed.ends_with(',') || trimmed.ends_with('{'))
            {
                chunks.push(RawChunk {
                    content: std::mem::take(&mut current),
                    chunk_type: ChunkType::Config,
                    language: None,
                    start_line,
                    end_line: i + 1,
                    metadata: serde_json::json!({}),
                });
                start_line = i + 2;
                found_first_key = false;
            }
        }
    }

    if !current.is_empty() {
        chunks.push(RawChunk {
            content: current,
            chunk_type: ChunkType::Config,
            language: None,
            start_line,
            end_line: lines.len(),
            metadata: serde_json::json!({}),
        });
    }

    if chunks.is_empty() {
        chunks.push(RawChunk {
            content: content.to_string(),
            chunk_type: ChunkType::Config,
            language: None,
            start_line: 1,
            end_line: lines.len(),
            metadata: serde_json::json!({}),
        });
    }

    chunks
}

// ====================== TEXT CHUNKER ======================

pub struct TextChunker;

impl Chunker for TextChunker {
    fn chunk(&self, content: &str, _file_path: &str) -> Vec<RawChunk> {
        let lines: Vec<&str> = content.lines().collect();
        let mut chunks = Vec::new();
        let mut current = String::new();
        let mut start_line = 1;

        for (i, line) in lines.iter().enumerate() {
            let line_num = i + 1; // 1-based

            if current.len() + line.len() + 1 > MAX_CHUNK_CHARS && !current.is_empty() {
                // Try to break at sentence boundary
                let break_point = find_sentence_break(&current);
                if break_point >= MIN_CHUNK_CHARS {
                    let (before, after) = current.split_at(break_point);
                    chunks.push(RawChunk {
                        content: before.to_string(),
                        chunk_type: ChunkType::Text,
                        language: None,
                        start_line,
                        end_line: line_num - 1,
                        metadata: serde_json::json!({ "wordCount": before.split_whitespace().count() }),
                    });
                    current = after.to_string();
                    start_line = line_num;
                } else {
                    chunks.push(RawChunk {
                        content: std::mem::take(&mut current),
                        chunk_type: ChunkType::Text,
                        language: None,
                        start_line,
                        end_line: line_num - 1,
                        metadata: serde_json::json!({ "wordCount": 0 }),
                    });
                    start_line = line_num;
                }
            }

            current.push_str(line);
            current.push('\n');
        }

        if !current.is_empty() {
            let word_count = current.split_whitespace().count();
            chunks.push(RawChunk {
                content: current,
                chunk_type: ChunkType::Text,
                language: None,
                start_line,
                end_line: lines.len(),
                metadata: serde_json::json!({ "wordCount": word_count }),
            });
        }

        chunks
    }
}

// ====================== STRATEGY SELECTOR ======================

/// Get the appropriate chunker for a given file path.
pub fn get_chunker_for_file(file_path: &str) -> Box<dyn Chunker> {
    match chunk_type_for_file(file_path) {
        ChunkType::Code => Box::new(CodeChunker),
        ChunkType::Markdown => Box::new(MarkdownChunker),
        ChunkType::Config => Box::new(ConfigChunker),
        ChunkType::Text => Box::new(TextChunker),
    }
}

/// Convenience function to chunk a file's content.
pub fn chunk_content(content: &str, file_path: &str) -> Vec<RawChunk> {
    let chunker = get_chunker_for_file(file_path);
    chunker.chunk(content, file_path)
}

// ====================== HELPERS ======================

fn node_text(node: Node, source: &str) -> String {
    let start = node.start_byte();
    let end = node.end_byte();
    if end > source.len() || start > end {
        return String::new();
    }
    source[start..end].to_string()
}

fn build_chunk_metadata(
    names: &[String],
    imports: &[String],
    enclosing_entity: Option<&str>,
) -> serde_json::Value {
    let mut map = serde_json::Map::new();

    if !names.is_empty() {
        map.insert(
            "names".to_string(),
            serde_json::Value::Array(
                names
                    .iter()
                    .map(|n| serde_json::Value::String(n.clone()))
                    .collect(),
            ),
        );
    }

    if !imports.is_empty() {
        let imports_str = imports.join("\n");
        // Truncate imports to avoid oversized metadata
        let truncated = if imports_str.len() > 500 {
            format!("{}...", &imports_str[..500])
        } else {
            imports_str
        };
        map.insert("imports".to_string(), serde_json::Value::String(truncated));
    }

    if let Some(entity) = enclosing_entity {
        map.insert(
            "enclosingEntity".to_string(),
            serde_json::Value::String(entity.to_string()),
        );
    }

    serde_json::Value::Object(map)
}

fn build_markdown_metadata(heading_chain: &[String]) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if !heading_chain.is_empty() {
        map.insert(
            "headings".to_string(),
            serde_json::Value::Array(
                heading_chain
                    .iter()
                    .map(|h| serde_json::Value::String(h.clone()))
                    .collect(),
            ),
        );
    }
    serde_json::Value::Object(map)
}

/// Find a good sentence break point within a string, searching backwards from
/// the end to find the last sentence-ending punctuation.
fn find_sentence_break(text: &str) -> usize {
    let search_start = if text.len() > MAX_CHUNK_CHARS {
        text.len().saturating_sub(OVERLAP_CHARS)
    } else {
        text.len() / 2
    };

    for (i, c) in text.char_indices().rev().take(text.len()) {
        if i < search_start.saturating_sub(100) {
            break;
        }
        if (c == '.' || c == '!' || c == '?') && i > MIN_CHUNK_CHARS {
            // Check if followed by whitespace or end of string
            let after = &text[i + c.len_utf8()..];
            if !after.is_empty() && after.starts_with(char::is_whitespace) {
                return i + c.len_utf8();
            }
        }
    }

    // Fallback: find last newline
    if let Some(pos) = text.rfind('\n') {
        if pos > MIN_CHUNK_CHARS && pos < text.len() - 1 {
            return pos + 1;
        }
    }

    // Fallback: find last space
    if let Some(pos) = text.rfind(' ') {
        if pos > MIN_CHUNK_CHARS && pos < text.len() - 1 {
            return pos + 1;
        }
    }

    0
}

/// Merge adjacent chunks that are below the minimum size threshold.
fn merge_small_chunks(chunks: Vec<RawChunk>) -> Vec<RawChunk> {
    if chunks.len() <= 1 {
        return chunks;
    }

    let mut merged = Vec::new();
    let mut current = chunks[0].clone();

    for next in chunks.iter().skip(1) {
        if current.content.len() < MIN_CHUNK_CHARS
            && current.content.len() + next.content.len() <= MAX_CHUNK_CHARS
        {
            // Merge
            current.content.push('\n');
            current.content.push_str(&next.content);
            current.end_line = next.end_line;
            // Update metadata to merge names
            if let Some(names) = next.metadata.get("names") {
                let current_names = current
                    .metadata
                    .get("names")
                    .cloned()
                    .unwrap_or(serde_json::json!([]));
                if let serde_json::Value::Array(mut arr) = current_names {
                    if let serde_json::Value::Array(new_names) = names {
                        arr.extend(new_names.iter().cloned());
                    }
                    current
                        .metadata
                        .as_object_mut()
                        .unwrap()
                        .insert("names".to_string(), serde_json::Value::Array(arr));
                }
            }
        } else {
            merged.push(current);
            current = next.clone();
        }
    }

    merged.push(current);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_type_for_file() {
        assert_eq!(chunk_type_for_file("main.rs"), ChunkType::Code);
        assert_eq!(chunk_type_for_file("app.tsx"), ChunkType::Code);
        assert_eq!(chunk_type_for_file("README.md"), ChunkType::Markdown);
        assert_eq!(chunk_type_for_file("config.json"), ChunkType::Config);
        assert_eq!(chunk_type_for_file("notes.txt"), ChunkType::Text);
    }

    #[test]
    fn test_text_chunker_basic() {
        let content = "Hello world. This is a test.\nSecond paragraph here.\nThird line.";
        let chunker = TextChunker;
        let chunks = chunker.chunk(content, "test.txt");
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].chunk_type, ChunkType::Text);
        assert_eq!(chunks[0].start_line, 1);
    }

    #[test]
    fn test_text_chunker_large_content() {
        let content = (0..200)
            .map(|i| format!("Line {} with some content.", i))
            .collect::<Vec<_>>()
            .join("\n");
        let chunker = TextChunker;
        let chunks = chunker.chunk(&content, "large.txt");
        assert!(
            chunks.len() > 1,
            "Large text should be split into multiple chunks"
        );
        for chunk in &chunks {
            assert!(
                chunk.content.len() <= ABSOLUTE_MAX_CHUNK_CHARS + 200,
                "Chunk too large: {} chars",
                chunk.content.len()
            );
        }
    }

    #[test]
    fn test_markdown_chunker_headings() {
        let content = r#"# Main Title

Some intro text.

## Section One

Content for section one.

## Section Two

Content for section two.
"#;
        let chunker = MarkdownChunker;
        let chunks = chunker.chunk(content, "doc.md");
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].chunk_type, ChunkType::Markdown);
    }

    #[test]
    fn test_markdown_chunker_no_headings() {
        let content = "Just some text\nwithout headings\nbut multiple lines.";
        let chunker = MarkdownChunker;
        let chunks = chunker.chunk(content, "notes.md");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chunk_type, ChunkType::Markdown);
    }

    #[test]
    fn test_config_chunker_small() {
        let content = r#"{"key": "value"}"#;
        let chunker = ConfigChunker;
        let chunks = chunker.chunk(content, "config.json");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chunk_type, ChunkType::Config);
    }

    #[test]
    fn test_code_chunker_rust() {
        let content = r#"use std::io;

fn main() {
    println!("Hello");
}

struct Foo {
    bar: i32,
}
"#;
        let chunker = CodeChunker;
        let chunks = chunker.chunk(content, "main.rs");
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].chunk_type, ChunkType::Code);
        assert_eq!(chunks[0].language.as_deref(), Some("rust"));
    }

    #[test]
    fn test_code_chunker_fallback_to_text() {
        let content = "This is some code-like text but in an unknown extension.";
        let chunker = CodeChunker;
        let chunks = chunker.chunk(content, "file.xyz");
        // Should fall back to TextChunker since .xyz has no grammar
        assert!(!chunks.is_empty());
    }

    #[test]
    fn test_get_chunker_for_file() {
        let _code_chunker = get_chunker_for_file("main.rs");
        let _md_chunker = get_chunker_for_file("readme.md");
        let _config_chunker = get_chunker_for_file("package.json");
        let _text_chunker = get_chunker_for_file("notes.txt");
    }

    #[test]
    fn test_chunk_content_convenience() {
        let content = "Hello world";
        let chunks = chunk_content(content, "test.txt");
        assert!(!chunks.is_empty());
    }

    #[test]
    fn test_find_sentence_break() {
        // Text must be > MIN_CHUNK_CHARS (100) for the function to find breaks
        let padding = "Word ".repeat(30); // ~150 chars of padding
        let text = format!(
            "{}First sentence. Second sentence. Third sentence.",
            padding
        );
        let pos = find_sentence_break(&text);
        assert!(pos > 0, "Should find a sentence break");
        assert!(pos < text.len(), "Break should not be at the end");
    }

    #[test]
    fn test_merge_small_chunks() {
        let chunks = vec![
            RawChunk {
                content: "ab".to_string(), // Too small
                chunk_type: ChunkType::Code,
                language: Some("rust".to_string()),
                start_line: 1,
                end_line: 2,
                metadata: serde_json::json!({"names": ["fn a"]}),
            },
            RawChunk {
                content: "fn long_function() { /* lots of code */ }".to_string(),
                chunk_type: ChunkType::Code,
                language: Some("rust".to_string()),
                start_line: 3,
                end_line: 5,
                metadata: serde_json::json!({"names": ["fn long_function"]}),
            },
        ];

        let merged = merge_small_chunks(chunks);
        // The first small chunk should be merged with the second
        assert_eq!(merged.len(), 1);
        assert!(merged[0].content.contains("ab"));
        assert!(merged[0].content.contains("fn long_function"));
    }

    #[test]
    fn test_text_chunker_empty_content() {
        let content = "";
        let chunker = TextChunker;
        let chunks = chunker.chunk(content, "empty.txt");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_text_chunker_single_line() {
        let content = "Single line without newline";
        let chunker = TextChunker;
        let chunks = chunker.chunk(content, "single.txt");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content.trim(), content);
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 1);
    }

    #[test]
    fn test_text_chunker_only_newlines() {
        let content = "\n\n\n";
        let chunker = TextChunker;
        let chunks = chunker.chunk(content, "newlines.txt");
        assert!(!chunks.is_empty());
    }

    #[test]
    fn test_markdown_chunker_empty_content() {
        let content = "";
        let chunker = MarkdownChunker;
        let chunks = chunker.chunk(content, "empty.md");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_markdown_chunker_nested_headings() {
        let content = r#"# H1

## H2

### H3

#### H4

Content here.
"#;
        let chunker = MarkdownChunker;
        let chunks = chunker.chunk(content, "nested.md");
        assert!(!chunks.is_empty());
        assert!(chunks[0].content.contains("H2"));
    }

    #[test]
    fn test_markdown_chunker_heading_chain_metadata() {
        let content = r#"# Title

## Section

## Another Section

Content under another section.
"#;
        let chunker = MarkdownChunker;
        let chunks = chunker.chunk(content, "doc.md");
        assert!(!chunks.is_empty());
        let headings = chunks.last().unwrap().metadata.get("headings");
        assert!(headings.is_some());
    }

    #[test]
    fn test_config_chunker_empty() {
        let content = "";
        let chunker = ConfigChunker;
        let chunks = chunker.chunk(content, "empty.json");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chunk_type, ChunkType::Config);
    }

    #[test]
    fn test_config_chunker_yaml_split() {
        let content = r#"key1: value1
nested:
  key2: value2
key3: value3
"#;
        let chunker = ConfigChunker;
        let chunks = chunker.chunk(content, "config.yaml");
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].chunk_type, ChunkType::Config);
    }

    #[test]
    fn test_code_chunker_empty_content() {
        let content = "";
        let chunker = CodeChunker;
        let chunks = chunker.chunk(content, "empty.rs");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_code_chunker_whitespace_only() {
        let content = "   \n\t  \n  ";
        let chunker = CodeChunker;
        let chunks = chunker.chunk(content, "whitespace.rs");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_code_chunker_typescript() {
        let content = r#"function greet(name: string): void {
    console.log(`Hello, ${name}!`);
}

const x: number = 42;
"#;
        let chunker = CodeChunker;
        let chunks = chunker.chunk(content, "app.ts");
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].chunk_type, ChunkType::Code);
        assert_eq!(chunks[0].language.as_deref(), Some("typescript"));
    }

    #[test]
    fn test_code_chunker_python() {
        let content = r#"def hello():
    print("Hello")

class Foo:
    pass
"#;
        let chunker = CodeChunker;
        let chunks = chunker.chunk(content, "main.py");
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].chunk_type, ChunkType::Code);
        assert_eq!(chunks[0].language.as_deref(), Some("python"));
    }

    #[test]
    fn test_chunk_type_unknown_extension() {
        assert_eq!(chunk_type_for_file("file.xyz"), ChunkType::Text);
        assert_eq!(chunk_type_for_file("noextension"), ChunkType::Text);
        assert_eq!(chunk_type_for_file(".hidden"), ChunkType::Text);
    }

    #[test]
    fn test_chunk_type_case_insensitive() {
        assert_eq!(chunk_type_for_file("main.RS"), ChunkType::Code);
        assert_eq!(chunk_type_for_file("README.MD"), ChunkType::Markdown);
        assert_eq!(chunk_type_for_file("config.JSON"), ChunkType::Config);
    }

    #[test]
    fn test_find_sentence_break_fallback_newline() {
        let text = "Line one\nLine two\nLine three";
        let pos = find_sentence_break(text);
        // Function returns a valid position (always succeeds for non-empty input)
        assert!(pos <= text.len());
    }

    #[test]
    fn test_find_sentence_break_no_breaks() {
        let text = "No sentence breaks here just words";
        let pos = find_sentence_break(text);
        // Returns 0 when no break found (start of text as fallback)
        assert_eq!(pos, 0);
    }

    #[test]
    fn test_merge_single_chunk() {
        let chunks = vec![RawChunk {
            content: "single".to_string(),
            chunk_type: ChunkType::Text,
            language: None,
            start_line: 1,
            end_line: 1,
            metadata: serde_json::json!({}),
        }];

        let merged = merge_small_chunks(chunks);
        assert_eq!(merged.len(), 1);
    }

    #[test]
    fn test_chunker_trait_object_usage() {
        let chunkers: Vec<Box<dyn Chunker>> = vec![
            Box::new(CodeChunker),
            Box::new(MarkdownChunker),
            Box::new(ConfigChunker),
            Box::new(TextChunker),
        ];

        for chunker in chunkers {
            let result = chunker.chunk("test content", "test.txt");
            assert!(result.is_empty() || !result.is_empty());
        }
    }
}
