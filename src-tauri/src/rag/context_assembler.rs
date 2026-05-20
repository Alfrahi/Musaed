//! RAG context assembly — formats search results into a system prompt.
//!
//! Ported from `apps/web/src/features/rag/utils/context-assembler.ts`.
//! The output MUST be byte-identical to the TypeScript implementation to
//! ensure deterministic cross-language behaviour.

use crate::generated_validation::MAX_RAG_CONTEXT_CHARS;
use crate::rag::types::{AssembledContext, Citation, SearchResult};

/// Build a RAG system prompt context string from search results.
///
/// This is injected before the main system prompt in chat messages.
/// Results are appended in order until the character budget is exceeded.
pub fn build_rag_system_context(
    results: &[SearchResult],
    project_path: &str,
    max_chars: usize,
) -> (String, Vec<Citation>, usize) {
    if results.is_empty() {
        return (String::new(), Vec::new(), 0);
    }

    let header = format!(
        "You have access to the following codebase context from the project at \"{}\". \
Use this information to answer the user's question. Always reference the file \
path and line numbers when referring to specific code.\n\n",
        project_path
    );

    let mut context = header.clone();
    let mut total_chars = context.len();
    let mut citations: Vec<Citation> = Vec::new();

    for (i, result) in results.iter().enumerate() {
        let lang_tag = match &result.language {
            Some(lang) => format!("`{}`", lang),
            None => String::new(),
        };

        let source_block = format!(
            "### Source {}: {} (lines {}-{}) {}\n```\n{}\n```\n\n",
            i + 1,
            result.file_path,
            result.start_line,
            result.end_line,
            lang_tag,
            result.content
        );

        if total_chars + source_block.len() > max_chars {
            break;
        }

        context.push_str(&source_block);
        total_chars += source_block.len();

        citations.push(Citation {
            file_path: result.file_path.clone(),
            start_line: result.start_line,
            end_line: result.end_line,
            language: result.language.clone(),
        });
    }

    // Rough token estimate: ~4 chars per token (conservative for code)
    let token_count = context.len() / 4;

    (context, citations, token_count)
}

/// Convenience wrapper that assembles context using the default character budget.
pub fn assemble_context(
    results: &[SearchResult],
    project_path: &str,
    max_chars: Option<usize>,
) -> AssembledContext {
    let max = max_chars.unwrap_or(MAX_RAG_CONTEXT_CHARS);
    let (assembled_context, citations, token_count) =
        build_rag_system_context(results, project_path, max);
    AssembledContext {
        assembled_context,
        citations,
        token_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::types::SearchResult;
    use serde_json::json;

    fn make_result(
        file_path: &str,
        content: &str,
        start_line: usize,
        end_line: usize,
        language: Option<&str>,
    ) -> SearchResult {
        SearchResult {
            chunk_id: 1,
            content: content.to_string(),
            chunk_type: "code".to_string(),
            language: language.map(|s| s.to_string()),
            start_line,
            end_line,
            file_path: file_path.to_string(),
            score: 0.9,
            metadata: json!({}),
        }
    }

    #[test]
    fn empty_results_returns_empty() {
        let (ctx, citations, tokens) = build_rag_system_context(&[], "/project", 20_000);
        assert!(ctx.is_empty());
        assert!(citations.is_empty());
        assert_eq!(tokens, 0);
    }

    #[test]
    fn single_result_formats_correctly() {
        let results = vec![make_result(
            "src/main.rs",
            "fn main() {}",
            1,
            3,
            Some("rust"),
        )];
        let (ctx, citations, tokens) = build_rag_system_context(&results, "/my/project", 20_000);

        assert!(ctx.contains("You have access to the following codebase context"));
        assert!(ctx.contains("### Source 1: src/main.rs (lines 1-3) `rust`"));
        assert!(ctx.contains("fn main() {}"));
        assert!(ctx.contains("/my/project"));
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].file_path, "src/main.rs");
        assert!(tokens > 0);
    }

    #[test]
    fn no_language_omits_lang_tag() {
        let results = vec![make_result("README.md", "Hello world", 1, 5, None)];
        let (ctx, _, _) = build_rag_system_context(&results, "/project", 20_000);

        // Header line should have trailing space (empty lang tag) but no backtick-wrapped tag
        assert!(ctx.contains("### Source 1: README.md (lines 1-5) \n"));

        // No source header line should contain a backtick-enclosed language tag
        for line in ctx.lines() {
            if line.starts_with("### Source") {
                assert!(
                    !line.contains('`'),
                    "source header should not have lang tag: {line}"
                );
            }
        }
    }

    #[test]
    fn char_budget_stops_adding_results() {
        // Header (~216 chars) + source prefix (~46 chars) + content + suffix (~6 chars)
        // Total = ~268 + content. With content=19_700, total ≈ 19_968 < 20_000 (first fits).
        // Remaining budget too small for second result, so it is skipped.
        let big_content = "x".repeat(19_700);
        let results = vec![
            make_result("a.rs", &big_content, 1, 100, Some("rust")),
            make_result("b.rs", "small", 1, 5, Some("rust")),
        ];
        let (ctx, citations, _) = build_rag_system_context(&results, "/project", 20_000);

        // The first result alone (~19.7k chars + header + source formatting) should consume
        // most of the 20k budget, so the second result should not fit.
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].file_path, "a.rs");
        assert!(!ctx.contains("### Source 2"));
    }

    #[test]
    fn multiple_results_within_budget() {
        let results = vec![
            make_result("a.rs", "fn a() {}", 1, 3, Some("rust")),
            make_result("b.rs", "fn b() {}", 1, 3, Some("rust")),
        ];
        let (ctx, citations, _) = build_rag_system_context(&results, "/project", 20_000);

        assert_eq!(citations.len(), 2);
        assert!(ctx.contains("### Source 1:"));
        assert!(ctx.contains("### Source 2:"));
    }

    #[test]
    fn assemble_context_convenience_fn() {
        let results = vec![make_result("a.rs", "fn a() {}", 1, 3, Some("rust"))];
        let assembled = assemble_context(&results, "/project", None);

        assert!(!assembled.assembled_context.is_empty());
        assert_eq!(assembled.citations.len(), 1);
        assert!(assembled.token_count > 0);
    }

    #[test]
    fn exact_js_header_format() {
        let results = vec![make_result(
            "src/lib.ts",
            "export const x = 1;",
            10,
            12,
            Some("typescript"),
        )];
        let (ctx, _, _) = build_rag_system_context(&results, "/home/user/proj", 20_000);

        // Verify the header exactly matches the JS output
        let expected_header = "You have access to the following codebase context from the project at \"/home/user/proj\". Use this information to answer the user's question. Always reference the file path and line numbers when referring to specific code.\n\n";
        assert!(ctx.starts_with(expected_header));

        // Verify source block format
        assert!(ctx.contains("### Source 1: src/lib.ts (lines 10-12) `typescript`\n```\nexport const x = 1;\n```\n\n"));
    }
}
