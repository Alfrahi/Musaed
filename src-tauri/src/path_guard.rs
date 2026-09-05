//! Canonical path resolution and root-boundary enforcement.
//!
//! Single implementation of the "resolve a path and prove it stays inside a
//! root" pattern, shared by the fs commands (user-granted roots), the RAG
//! services (project roots), and the RAG store. Consolidates what used to be
//! four near-identical copies (AUDIT Refactoring #4).

use std::path::{Path, PathBuf};

/// Canonicalizes `path`, resolving symlinks down to the deepest existing
/// ancestor and re-appending any not-yet-existing tail components, so that
/// fresh save-dialog targets still compare correctly against granted roots.
///
/// Both grant-time and access-time go through this function, keeping the
/// Windows verbatim-path prefix (`\\?\`) consistent on both sides of the
/// prefix comparison.
///
/// Returns `None` when even the root-most component cannot be resolved.
pub(crate) fn lenient_canonicalize(path: &Path) -> Option<PathBuf> {
    let mut base = path.to_path_buf();
    let mut missing_tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match base.canonicalize() {
            Ok(mut resolved) => {
                for part in missing_tail.iter().rev() {
                    resolved.push(part);
                }
                return Some(resolved);
            }
            Err(_) => {
                let name = base.file_name()?.to_os_string();
                missing_tail.push(name);
                if !base.pop() {
                    return None;
                }
            }
        }
    }
}

/// Strictly canonicalizes `path` (it must exist), mapping failures to a
/// caller-friendly message.
pub(crate) fn canonicalize(path: &Path, err_ctx: &str) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("{}: {}", err_ctx, e))
}

/// Canonicalizes both paths (strict — both must exist) and verifies
/// `target` stays inside `root`, including symlink resolution.
///
/// `Path::starts_with` compares path *components*, so a sibling whose name
/// merely shares a string prefix (e.g. `/proj` vs `/proj-evil`) is rejected.
pub(crate) fn resolve_within(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let canonical_root = canonicalize(root, "Failed to resolve project root")?;
    let canonical_target = canonicalize(target, "Target path does not exist or is inaccessible")?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!(
            "Path escapes project boundary: {:?} is not within {:?}",
            canonical_target, canonical_root
        ));
    }
    Ok(canonical_target)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_within_accepts_child_path() {
        let root = tempfile::tempdir().unwrap();
        let child = root.path().join("sub");
        std::fs::create_dir(&child).unwrap();

        let resolved = resolve_within(root.path(), &child).expect("child must resolve");
        assert_eq!(resolved, child.canonicalize().unwrap());
    }

    #[test]
    fn resolve_within_rejects_parent_traversal() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("..");
        let err = resolve_within(root.path(), &target).unwrap_err();
        assert!(
            err.contains("escapes project boundary"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn resolve_within_rejects_prefix_sibling() {
        // /tmp/proj and /tmp/proj-evil share a string prefix but not path
        // components — component-wise comparison must reject.
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("proj");
        let sibling = base.path().join("proj-evil");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let err = resolve_within(&root, &sibling).unwrap_err();
        assert!(
            err.contains("escapes project boundary"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn resolve_within_rejects_symlink_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = root.path().join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(outside.path(), &link).unwrap();

        let err = resolve_within(root.path(), &link).unwrap_err();
        assert!(
            err.contains("escapes project boundary"),
            "symlink must resolve outside root; got: {}",
            err
        );
    }

    #[test]
    fn resolve_within_rejects_nonexistent_target() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("does-not-exist");
        let err = resolve_within(root.path(), &missing).unwrap_err();
        assert!(err.contains("does not exist"), "unexpected error: {}", err);
    }
}
