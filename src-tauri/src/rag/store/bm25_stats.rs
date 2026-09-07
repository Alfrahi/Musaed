//! Per-project BM25 statistics persistence.
//!
//! Hybrid search must score candidates against the *whole project corpus*,
//! not the per-query candidate window, or IDF and length normalization become
//! non-comparable across queries. These tables store the per-project
//! document frequency and average length, maintained transactionally on every
//! chunk insert/delete and lazily rebuilt when absent (which also backfills
//! the v5 migration without SQL-side tokenization).

use crate::rag::bm25::{tokenize, CorpusStats};
use crate::rag::error::RagResult;
use rusqlite::params;
use std::collections::HashMap;

/// Add a chunk's terms to the corpus statistics for its project.
///
/// Must be called inside the same transaction as the chunk insert so a crash
/// cannot leave stats out of sync with `chunks`.
pub(super) fn add_chunk_stats(
    tx: &rusqlite::Transaction,
    project_id: &str,
    chunk_id: i64,
    content: &str,
) -> RagResult<()> {
    let terms = tokenize(content);
    let len = terms.len() as i64;

    tx.execute(
        "INSERT INTO bm25_doc_len (project_id, chunk_id, len) VALUES (?1, ?2, ?3)",
        params![project_id, chunk_id, len],
    )?;

    // Document frequency counts *documents* containing a term, not total
    // occurrences — BM25 IDF requires the former. Deduplicate terms so a term
    // repeated within one chunk increments its document frequency by exactly 1.
    let mut unique: HashMap<&str, ()> = HashMap::new();
    for term in &terms {
        unique.insert(term.as_str(), ());
    }
    for term in unique.keys() {
        tx.execute(
            "INSERT INTO bm25_doc_freq (project_id, term, doc_count) VALUES (?1, ?2, 1) \
             ON CONFLICT(project_id, term) DO UPDATE SET doc_count = doc_count + 1",
            params![project_id, term],
        )?;
    }

    Ok(())
}

/// Remove a chunk's terms from the corpus statistics for its project.
///
/// Must be called inside the same transaction as the chunk delete.
pub(super) fn remove_chunk_stats(
    tx: &rusqlite::Transaction,
    project_id: &str,
    chunk_id: i64,
    content: &str,
) -> RagResult<()> {
    let terms = tokenize(content);

    tx.execute(
        "DELETE FROM bm25_doc_len WHERE project_id = ?1 AND chunk_id = ?2",
        params![project_id, chunk_id],
    )?;

    // Decrement document frequency by 1 per *document* containing the term,
    // mirroring `add_chunk_stats`'s deduplication.
    let mut unique: HashMap<&str, ()> = HashMap::new();
    for term in &terms {
        unique.insert(term.as_str(), ());
    }
    for term in unique.keys() {
        tx.execute(
            "UPDATE bm25_doc_freq SET doc_count = doc_count - 1 WHERE project_id = ?1 AND term = ?2",
            params![project_id, term],
        )?;
        // Drop terms that no longer occur in any document of this project.
        tx.execute(
            "DELETE FROM bm25_doc_freq WHERE project_id = ?1 AND term = ?2 AND doc_count <= 0",
            params![project_id, term],
        )?;
    }

    Ok(())
}

/// Remove all corpus statistics for a project.
///
/// Must be called inside the same transaction that deletes the project's
/// chunks (project deletion or embedding-model reset).
pub(super) fn clear_project_stats(tx: &rusqlite::Transaction, project_id: &str) -> RagResult<()> {
    tx.execute(
        "DELETE FROM bm25_doc_len WHERE project_id = ?1",
        params![project_id],
    )?;
    tx.execute(
        "DELETE FROM bm25_doc_freq WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(())
}

/// Load corpus statistics for a project, rebuilding them from `chunks` if the
/// tables are empty for that project (covers the v5 upgrade backfill and any
/// per-project drift).
pub(super) fn load_corpus_stats(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> RagResult<CorpusStats> {
    let doc_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chunks WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    if doc_count == 0 {
        return Ok(CorpusStats::default());
    }

    let stats_doc_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM bm25_doc_len WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    if stats_doc_count == 0 {
        rebuild_project_stats(conn, project_id)?;
    }

    let doc_freq: HashMap<String, usize> = {
        let mut stmt =
            conn.prepare("SELECT term, doc_count FROM bm25_doc_freq WHERE project_id = ?1")?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (term, n) = row?;
            if n > 0 {
                map.insert(term, n as usize);
            }
        }
        map
    };

    let total_len: i64 = conn.query_row(
        "SELECT COALESCE(SUM(len), 0) FROM bm25_doc_len WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    let avg_doc_len = if doc_count > 0 {
        total_len as f32 / doc_count as f32
    } else {
        0.0
    };

    Ok(CorpusStats {
        doc_freq,
        doc_count: doc_count as usize,
        avg_doc_len,
    })
}

/// Rebuild the corpus statistics for a single project from the `chunks` table.
fn rebuild_project_stats(conn: &rusqlite::Connection, project_id: &str) -> RagResult<()> {
    let mut stmt = conn.prepare("SELECT id, content FROM chunks WHERE project_id = ?1")?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut doc_freq: HashMap<String, usize> = HashMap::new();
    let mut doc_len_rows: Vec<(i64, i64)> = Vec::new();

    for row in rows {
        let (chunk_id, content) = row?;
        let terms = tokenize(&content);
        let len = terms.len();
        doc_len_rows.push((chunk_id, len as i64));

        // Document frequency: count each unique term once per document.
        let mut unique: HashMap<&str, ()> = HashMap::new();
        for term in &terms {
            unique.insert(term.as_str(), ());
        }
        for term in unique.keys() {
            *doc_freq.entry(term.to_string()).or_insert(0) += 1;
        }
    }

    // Rebuild is not transactional with the caller's read; use a write
    // transaction here so the tables are populated atomically. Scope deletes
    // to this project so other projects' stats are preserved.
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM bm25_doc_len WHERE project_id = ?1",
        params![project_id],
    )?;
    tx.execute(
        "DELETE FROM bm25_doc_freq WHERE project_id = ?1",
        params![project_id],
    )?;
    for (chunk_id, len) in doc_len_rows {
        tx.execute(
            "INSERT INTO bm25_doc_len (project_id, chunk_id, len) VALUES (?1, ?2, ?3)",
            params![project_id, chunk_id, len],
        )?;
    }
    for (term, n) in doc_freq {
        tx.execute(
            "INSERT INTO bm25_doc_freq (project_id, term, doc_count) VALUES (?1, ?2, ?3)",
            params![project_id, term, n as i64],
        )?;
    }
    tx.commit()?;

    Ok(())
}
