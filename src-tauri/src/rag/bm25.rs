//! BM25 ranking for hybrid search in RAG.

use std::collections::HashMap;
use whatlang::Lang;

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
                *doc_freq.entry(term).or_insert(0) += 1;
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
fn tokenize(text: &str) -> Vec<String> {
    // Detect language for better tokenization (optional)
    let _lang = whatlang::detect(text)
        .map(|info| info.lang())
        .unwrap_or(Lang::Eng);

    // Simple tokenization: split on non-alphanumeric characters
    text.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize() {
        let tokens = tokenize("hello world! rust_2023");
        assert_eq!(tokens, vec!["hello", "world", "rust_2023"]);
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

        assert!(score1 > score3); // Document 1 should score higher for "hello"
        assert!(score2 > score3); // Document 2 should score higher for "hello"
        assert!(score1 > 0.0); // Non-zero score for matching document
        assert_eq!(score3, 0.0); // Zero score for non-matching document
    }

    #[test]
    fn test_bm25_empty_documents_returns_zero() {
        // Regression test for division by zero bug
        let documents: Vec<(usize, String)> = vec![];
        let bm25 = BM25::new(&documents);

        // Should return 0.0, not panic or return NaN
        let score = bm25.score("query", 1);
        assert_eq!(score, 0.0);
        assert!(!score.is_nan(), "Score should not be NaN");
    }
}
