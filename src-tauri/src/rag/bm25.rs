//! BM25 ranking for hybrid search in RAG.

use std::collections::HashMap;

/// BM25 parameters.
const K1: f32 = 1.5;
const B: f32 = 0.75;

/// BM25 ranking implementation.
pub struct BM25 {
    /// Document frequency: number of documents containing each term.
    doc_freq: HashMap<String, usize>,
    /// Total number of documents.
    doc_count: usize,
    /// Average document length.
    avg_doc_len: f32,
    /// Document lengths.
    doc_len: HashMap<usize, usize>, // chunk_id -> length
    /// Term frequencies per document.
    term_freq: HashMap<usize, HashMap<String, usize>>, // chunk_id -> term -> freq
}

/// Precomputed corpus-wide statistics for BM25 scoring.
///
/// Unlike [`BM25::new`], which derives statistics from whatever document
/// slice it is handed, this carries the *whole-corpus* document frequency and
/// average length. Hybrid search must score candidates against the full
/// project corpus — not the per-query candidate window — or IDF and length
/// normalization become non-comparable across queries.
#[derive(Debug, Clone, Default)]
pub struct CorpusStats {
    /// Number of documents containing each term (whole corpus).
    pub doc_freq: HashMap<String, usize>,
    /// Total number of documents in the corpus.
    pub doc_count: usize,
    /// Average document length (in tokens) across the corpus.
    pub avg_doc_len: f32,
}

impl BM25 {
    /// Create a new BM25 instance from a collection of documents.
    pub fn new(documents: &[(usize, String)]) -> Self {
        let mut doc_freq = HashMap::new();
        let mut term_freq = HashMap::new();
        let mut doc_len = HashMap::new();
        let mut doc_count = 0;
        let mut total_len = 0;

        for &(chunk_id, ref content) in documents {
            doc_count += 1;
            let terms = tokenize(content);
            let len = terms.len();
            total_len += len;
            doc_len.insert(chunk_id, len);

            let mut term_counts = HashMap::new();
            for term in terms {
                *term_counts.entry(term.clone()).or_insert(0) += 1;
            }

            // doc_freq counts documents containing each term (not total occurrences)
            for term in term_counts.keys() {
                *doc_freq.entry(term.clone()).or_insert(0) += 1;
            }

            term_freq.insert(chunk_id, term_counts);
        }

        let avg_doc_len = if doc_count > 0 {
            total_len as f32 / doc_count as f32
        } else {
            0.0
        };

        BM25 {
            doc_freq,
            doc_count,
            avg_doc_len,
            doc_len,
            term_freq,
        }
    }

    /// Create a BM25 scorer backed by precomputed corpus statistics.
    ///
    /// Per-document term frequencies and lengths are still computed from the
    /// candidate documents themselves (they are cheap and query-independent),
    /// but document frequency and average length come from the whole corpus
    /// so IDF is stable across queries.
    pub fn from_corpus(documents: &[(usize, String)], stats: &CorpusStats) -> Self {
        let mut term_freq = HashMap::new();
        let mut doc_len = HashMap::new();

        for &(chunk_id, ref content) in documents {
            let terms = tokenize(content);
            doc_len.insert(chunk_id, terms.len());

            let mut term_counts = HashMap::new();
            for term in terms {
                *term_counts.entry(term.clone()).or_insert(0) += 1;
            }
            term_freq.insert(chunk_id, term_counts);
        }

        BM25 {
            doc_freq: stats.doc_freq.clone(),
            doc_count: stats.doc_count,
            avg_doc_len: stats.avg_doc_len,
            doc_len,
            term_freq,
        }
    }

    /// Number of documents in the corpus backing this scorer.
    pub fn doc_count(&self) -> usize {
        self.doc_count
    }

    /// Average document length (in tokens) of the corpus backing this scorer.
    pub fn avg_doc_len(&self) -> f32 {
        self.avg_doc_len
    }

    /// Compute BM25 score for a query against a document.
    /// Returns 0.0 if no documents were indexed (avg_doc_len == 0.0).
    pub fn score(&self, query: &str, chunk_id: usize) -> f32 {
        // Guard against division by zero when no documents or all empty documents
        if self.avg_doc_len == 0.0 {
            return 0.0;
        }

        let terms = tokenize(query);
        let mut score = 0.0;
        let doc_len = self.doc_len.get(&chunk_id).copied().unwrap_or(0) as f32;

        for term in terms {
            let term_freq = self
                .term_freq
                .get(&chunk_id)
                .and_then(|tf| tf.get(&term))
                .copied()
                .unwrap_or(0) as f32;

            let doc_freq = self.doc_freq.get(&term).copied().unwrap_or(0) as f32;
            let idf = ((self.doc_count as f32 - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0).ln();

            let numerator = term_freq * (K1 + 1.0);
            let denominator = term_freq + K1 * (1.0 - B + B * doc_len / self.avg_doc_len);
            score += idf * numerator / denominator;
        }

        score
    }
}

/// Tokenize text into terms (words).
///
/// Identifier-aware: `camelCase` and `snake_case` identifiers contribute both
/// their full lowercase form and their sub-tokens, so a query for
/// "get user by id" matches a chunk containing `getUserById` (RAG R3).
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    for raw in text.split(|c: char| !c.is_alphanumeric() && c != '_') {
        if raw.is_empty() {
            continue;
        }
        let lower = raw.to_lowercase();
        tokens.push(lower.clone());
        let subtokens: Vec<String> = raw.split('_').flat_map(split_camel).collect();
        // Add sub-tokens only when they carry information beyond the whole.
        if subtokens.len() > 1 || subtokens.first().is_some_and(|s| *s != lower) {
            tokens.extend(subtokens);
        }
    }
    tokens
}

/// Split one `_`-free piece on lowercase→UPPERCASE boundaries, lowercased.
fn split_camel(piece: &str) -> Vec<String> {
    let chars: Vec<char> = piece.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if c.is_uppercase() && i > 0 && !chars[i - 1].is_uppercase() {
            out.push(std::mem::take(&mut cur));
        }
        cur.extend(c.to_lowercase());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize() {
        let tokens = tokenize("hello world! rust_2023");
        assert_eq!(tokens, vec!["hello", "world", "rust_2023", "rust", "2023"]);
    }

    #[test]
    fn test_tokenize_camel_case_identifier() {
        let tokens = tokenize("getUserById");
        assert_eq!(
            tokens,
            vec!["getuserbyid", "get", "user", "by", "id"],
            "camelCase must contribute the full identifier plus sub-tokens"
        );
    }

    #[test]
    fn test_tokenize_plain_words_unchanged() {
        // Plain lowercase words produce exactly one token (no duplication).
        assert_eq!(tokenize("hello"), vec!["hello"]);
    }

    #[test]
    fn test_identifier_query_matches_camel_doc() {
        // The R3 acceptance case: query "get user by id" must match a
        // document containing `getUserById`.
        let documents = vec![
            (1, "pub fn getUserById(id: i64)".to_string()),
            (2, "fn login(username: &str)".to_string()),
        ];
        let bm25 = BM25::new(&documents);
        let code_score = bm25.score("get user by id", 1);
        let other_score = bm25.score("get user by id", 2);
        assert!(code_score > 0.0);
        assert!(code_score > other_score);
    }

    #[test]
    fn test_tokenize_empty_string() {
        let tokens = tokenize("");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_tokenize_only_punctuation() {
        let tokens = tokenize("!!! ??? ...");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_tokenize_mixed_case() {
        // Case-folding still unifies plain words; `carelessCamel` shapes like
        // `HeLLo` additionally contribute identifier sub-tokens.
        let tokens = tokenize("Hello HELLO hello HeLLo");
        assert_eq!(
            tokens,
            vec!["hello", "hello", "hello", "hello", "he", "llo"]
        );
    }

    #[test]
    fn test_tokenize_unicode() {
        let tokens = tokenize("hello 世界 rust");
        assert_eq!(tokens, vec!["hello", "世界", "rust"]);
    }

    #[test]
    fn test_bm25_scoring() {
        let documents = vec![
            (1, "hello world".to_string()),
            (2, "hello rust".to_string()),
            (3, "world rust programming".to_string()),
        ];

        let bm25 = BM25::new(&documents);
        let score1 = bm25.score("hello", 1);
        let score2 = bm25.score("hello", 2);
        let score3 = bm25.score("hello", 3);

        assert!(score1 > score3);
        assert!(score2 > score3);
        assert!(score1 > 0.0);
        assert_eq!(score3, 0.0);
    }

    #[test]
    fn test_bm25_empty_documents_returns_zero() {
        let documents: Vec<(usize, String)> = vec![];
        let bm25 = BM25::new(&documents);
        let score = bm25.score("query", 1);
        assert_eq!(score, 0.0);
        assert!(!score.is_nan(), "Score should not be NaN");
    }

    #[test]
    fn test_bm25_empty_query_returns_zero() {
        let documents = vec![(1, "hello world".to_string())];
        let bm25 = BM25::new(&documents);
        let score = bm25.score("", 1);
        assert_eq!(score, 0.0);
    }

    #[test]
    fn test_bm25_all_empty_documents_returns_zero() {
        let documents = vec![
            (1, "".to_string()),
            (2, "".to_string()),
            (3, "".to_string()),
        ];
        let bm25 = BM25::new(&documents);
        let score = bm25.score("query", 1);
        assert_eq!(score, 0.0);
        assert!(!score.is_nan(), "Score should not be NaN");
    }

    #[test]
    fn test_bm25_nonexistent_chunk_id_returns_zero() {
        let documents = vec![(1, "hello world".to_string())];
        let bm25 = BM25::new(&documents);
        let score = bm25.score("hello", 999);
        assert_eq!(score, 0.0);
    }

    #[test]
    fn test_bm25_multi_term_query() {
        let documents = vec![
            (1, "hello world".to_string()),
            (2, "hello rust".to_string()),
            (3, "world rust".to_string()),
        ];

        let bm25 = BM25::new(&documents);
        let score1 = bm25.score("hello world", 1);
        let score2 = bm25.score("hello world", 2);
        let score3 = bm25.score("hello world", 3);

        assert!(score1 > score2);
        assert!(score1 > score3);
    }

    #[test]
    fn test_bm25_term_frequency_impact() {
        let documents = vec![
            (1, "rust rust rust".to_string()),
            (2, "rust".to_string()),
            (3, "python java go".to_string()),
        ];

        let bm25 = BM25::new(&documents);

        let score1 = bm25.score("rust", 1);
        let score3 = bm25.score("rust", 3);

        // Doc 1 contains "rust", doc 3 doesn't - doc 1 should score higher
        assert!(
            score1 > score3,
            "Document containing term should score higher than document without term. score1={}, score3={}",
            score1,
            score3
        );
        assert!(
            score1 > 0.0,
            "Document with term should have positive score"
        );
        assert_eq!(score3, 0.0, "Document without term should score zero");
    }
    #[test]
    fn test_bm25_document_frequency_impact() {
        let documents = vec![
            (1, "rust".to_string()),
            (2, "rust".to_string()),
            (3, "python".to_string()),
        ];

        let bm25 = BM25::new(&documents);
        let rust_score = bm25.score("rust", 1);
        let python_score = bm25.score("python", 3);

        assert!(
            python_score > rust_score,
            "Rare term (python) should score higher than common term (rust)"
        );
    }

    #[test]
    fn test_bm25_deterministic_scoring() {
        let documents = vec![
            (1, "the quick brown fox".to_string()),
            (2, "the lazy dog".to_string()),
        ];

        let bm25 = BM25::new(&documents);
        let score1_run1 = bm25.score("quick", 1);
        let score1_run2 = bm25.score("quick", 1);

        assert_eq!(
            score1_run1, score1_run2,
            "Scoring should be deterministic for same input"
        );
    }

    #[test]
    fn test_bm25_single_character_terms() {
        let documents = vec![(1, "a b c".to_string())];
        let bm25 = BM25::new(&documents);
        let score = bm25.score("a", 1);
        assert!(score > 0.0);
    }

    #[test]
    fn test_bm25_numbers_in_terms() {
        let documents = vec![(1, "version 1 2 3".to_string())];
        let bm25 = BM25::new(&documents);
        let score = bm25.score("1 2", 1);
        assert!(score > 0.0);
    }

    #[test]
    fn test_from_corpus_uses_corpus_idf_not_candidate_window() {
        // A corpus where "rust" is common (low IDF) and "zebra" is rare (high
        // IDF). The candidate window handed to `from_corpus` contains only a
        // single document, so a window-derived IDF would be wrong; the corpus
        // stats must dominate.
        let mut doc_freq = HashMap::new();
        doc_freq.insert("rust".to_string(), 100);
        doc_freq.insert("zebra".to_string(), 1);
        let stats = CorpusStats {
            doc_freq,
            doc_count: 100,
            avg_doc_len: 5.0,
        };

        let candidates = vec![(1, "rust zebra".to_string())];
        let bm25 = BM25::from_corpus(&candidates, &stats);

        let rust_score = bm25.score("rust", 1);
        let zebra_score = bm25.score("zebra", 1);

        // The rare term must score higher than the common term, proving the
        // corpus document frequency (not the 1-doc candidate window) is used.
        assert!(
            zebra_score > rust_score,
            "rare term should outrank common term: zebra={zebra_score}, rust={rust_score}"
        );
        assert_eq!(bm25.doc_count(), 100);
        assert_eq!(bm25.avg_doc_len(), 5.0);
    }

    #[test]
    fn test_from_corpus_empty_stats_scores_zero() {
        let candidates = vec![(1, "hello world".to_string())];
        let bm25 = BM25::from_corpus(&candidates, &CorpusStats::default());
        // avg_doc_len == 0.0 → score() guards to 0.0.
        assert_eq!(bm25.score("hello", 1), 0.0);
    }
}
