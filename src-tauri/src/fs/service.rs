use crate::error_codes;
pub(crate) use crate::path_guard::lenient_canonicalize;
use crate::payloads::{ApiResponse, BackendError};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Registry of filesystem locations the user has explicitly exposed to the
/// app this session — via native file dialogs (`cmd_dialog_open_file`,
/// `cmd_dialog_save_file`) or OS drag-drop onto the window. The `cmd_fs_*`
/// commands may only operate inside these roots, so the webview can never
/// address arbitrary paths on its own (STANDARDS §16).
///
/// ponytail ceiling: grants are in-memory only (re-pick required each
/// launch) and a symlink swapped mid-operation could still redirect one
/// access; both acceptable for a single-user offline desktop app.
#[derive(Default)]
pub struct FsAccessGrants(Mutex<HashSet<PathBuf>>);

impl FsAccessGrants {
    pub fn grant_paths<I: IntoIterator<Item = String>>(&self, paths: I) {
        let mut grants = self.lock();
        for raw in paths {
            if let Some(resolved) = lenient_canonicalize(Path::new(&raw)) {
                grants.insert(resolved);
            }
        }
    }

    pub(crate) fn is_granted(&self, resolved: &Path) -> bool {
        self.lock().iter().any(|root| resolved.starts_with(root))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<PathBuf>> {
        // Recover from poisoning rather than panicking into the UI (§13).
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

enum FsAccessError {
    /// Path could not be resolved to a concrete location.
    Unresolvable(String),
    /// Resolved but is not a regular file where one is required.
    NotAFile(String),
    /// Resolved but lies outside every user-granted location.
    Denied(String),
}

impl FsAccessError {
    fn message(&self) -> String {
        match self {
            Self::Unresolvable(p) => format!("File not found: {}", p),
            Self::NotAFile(p) => format!("Path is not a file: {}", p),
            Self::Denied(p) => format!("Access denied: '{}' is outside user-granted locations", p),
        }
    }
}

/// Verifies the raw frontend-supplied path lies inside a granted root and
/// returns its canonical form for actual I/O.
fn authorize(grants: &FsAccessGrants, raw: &str) -> Result<PathBuf, FsAccessError> {
    let Some(resolved) = lenient_canonicalize(Path::new(raw)) else {
        return Err(FsAccessError::Unresolvable(raw.to_string()));
    };
    if !grants.is_granted(&resolved) {
        return Err(FsAccessError::Denied(raw.to_string()));
    }
    Ok(resolved)
}

fn failure<T>(err: FsAccessError) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(
            error_codes::FILE_SYSTEM_ERROR,
            err.message(),
        )),
    }
}

fn io_failure<T>(action: &str, path: &str, err: std::io::Error) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(
            error_codes::FILE_SYSTEM_ERROR,
            format!("Failed to {} '{}': {}", action, path, err),
        )),
    }
}

/// Authorization for read operations: grants plus the historical error
/// surface (missing files report not-found, directories report not-a-file).
///
/// Opens the `File` handle here so the subsequent read operates on the exact
/// inode that was authorized — closing the TOCTOU window where the path is
/// re-resolved between the grant check and `std::fs::read` (B3).
fn require_granted_file(
    grants: &FsAccessGrants,
    raw: &str,
) -> Result<std::fs::File, FsAccessError> {
    let resolved = authorize(grants, raw)?;
    if !resolved.exists() {
        return Err(FsAccessError::Unresolvable(raw.to_string()));
    }
    if !resolved.is_file() {
        return Err(FsAccessError::NotAFile(raw.to_string()));
    }
    std::fs::File::open(&resolved).map_err(|_| FsAccessError::Unresolvable(raw.to_string()))
}

pub(crate) fn read_text_file_impl(grants: &FsAccessGrants, path: &str) -> ApiResponse<String> {
    let file = match require_granted_file(grants, path) {
        Ok(f) => f,
        Err(e) => return failure(e),
    };

    use std::io::Read;
    let mut content = String::new();
    match std::io::BufReader::new(file).read_to_string(&mut content) {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(content),
            error: None,
        },
        Err(e) => io_failure("read file", path, e),
    }
}

pub(crate) fn read_file_base64_impl(grants: &FsAccessGrants, path: &str) -> ApiResponse<String> {
    let file = match require_granted_file(grants, path) {
        Ok(f) => f,
        Err(e) => return failure(e),
    };

    use std::io::Read;
    let mut bytes = Vec::new();
    match std::io::BufReader::new(file).read_to_end(&mut bytes) {
        Ok(_) => {
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            ApiResponse {
                success: true,
                data: Some(encoded),
                error: None,
            }
        }
        Err(e) => io_failure("read file", path, e),
    }
}

pub(crate) fn write_text_file_impl(
    grants: &FsAccessGrants,
    path: &str,
    content: String,
) -> ApiResponse<bool> {
    // Bound the write size before touching the filesystem (defense against a
    // compromised frontend flooding disk).
    if content.len() > crate::generated_validation::MAX_FILE_WRITE_LEN {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!(
                    "Write exceeds {} bytes (got {})",
                    crate::generated_validation::MAX_FILE_WRITE_LEN,
                    content.len()
                ),
            )),
        };
    }

    // Authorization precedes parent-directory creation so a denied write
    // never leaves directories behind.
    let resolved = match authorize(grants, path) {
        Ok(p) => p,
        Err(e) => return failure(e),
    };

    if let Some(parent) = resolved.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return io_failure("create parent directories", path, e);
        }
    }

    // Open the authorized file handle with explicit OpenOptions (write +
    // create + truncate) and write through that handle, mirroring the
    // read-side `require_granted_file` pattern: the handle is bound to the
    // inode resolved by `authorize`, so the write does not re-resolve the
    // path.
    //
    // Residual TOCTOU: `create_dir_all(parent)` above still re-resolves the
    // parent path, so a concurrent local process could swap a symlink in a
    // *missing* parent directory between `authorize` and this open. A fully
    // race-free implementation would require `openat`-style directory-fd-
    // relative operations, which Rust's std does not expose portably. This is
    // the same documented ceiling as the read path and is only reachable by a
    // second local process with write access to the granted directory — not by
    // the renderer, which cannot mint grants or create symlinks.
    use std::io::Write;
    let file = match std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&resolved)
    {
        Ok(f) => f,
        Err(e) => return io_failure("write file", path, e),
    };
    match std::io::BufWriter::new(file).write_all(content.as_bytes()) {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => io_failure("write file", path, e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn grant(paths: &[&std::path::Path]) -> FsAccessGrants {
        let grants = FsAccessGrants::default();
        grants.grant_paths(paths.iter().map(|p| p.to_string_lossy().into_owned()));
        grants
    }

    #[test]
    fn test_read_text_file_requires_grant() {
        let tmp = NamedTempFile::new().unwrap();
        write!(tmp.as_file(), "secret").unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let grants = FsAccessGrants::default();
        let resp = read_text_file_impl(&grants, &path);
        assert!(!resp.success);
        assert!(resp.error.unwrap().message.contains("Access denied"));
    }

    #[test]
    fn test_read_text_file_success_when_granted() {
        let tmp = NamedTempFile::new().unwrap();
        write!(tmp.as_file(), "hello world").unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let grants = grant(&[tmp.path()]);
        let resp = read_text_file_impl(&grants, &path);
        assert!(resp.success);
        assert_eq!(resp.data.unwrap(), "hello world");
    }

    #[test]
    fn test_read_blocked_by_parent_escape() {
        let root_a = tempfile::tempdir().unwrap();
        let root_b = tempfile::tempdir().unwrap();
        let secret = root_b.path().join("secret.txt");
        std::fs::write(&secret, "top secret").unwrap();

        // Requesting a sibling root through ../ traversal from inside the
        // granted root must stay denied after canonicalization.
        let sibling_name = root_b.path().file_name().unwrap();
        let smuggled = root_a
            .path()
            .join("..")
            .join(sibling_name)
            .join("secret.txt");

        let grants = grant(&[root_a.path()]);
        let resp = read_text_file_impl(&grants, &smuggled.to_string_lossy());
        assert!(!resp.success);
        assert!(resp.error.unwrap().message.contains("Access denied"));
    }

    #[test]
    fn test_read_rejects_directory() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grant(&[dir.path()]);
        let resp = read_text_file_impl(&grants, &dir.path().to_string_lossy());
        assert!(!resp.success);
        assert!(resp.error.unwrap().message.contains("not a file"));
    }

    #[test]
    fn test_missing_file_under_granted_root_reports_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grant(&[dir.path()]);
        let target = dir.path().join("does-not-exist.txt");
        let resp = read_text_file_impl(&grants, &target.to_string_lossy());
        assert!(!resp.success);
        assert!(resp.error.unwrap().message.contains("File not found"));
    }

    #[test]
    fn test_read_file_base64_when_granted() {
        let mut tmp = NamedTempFile::new().unwrap();
        let data: Vec<u8> = vec![0, 1, 2, 3, 255];
        tmp.write_all(&data).unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let grants = grant(&[tmp.path()]);
        let resp = read_file_base64_impl(&grants, &path);
        assert!(resp.success);

        use base64::Engine;
        let expected = base64::engine::general_purpose::STANDARD.encode(&data);
        assert_eq!(resp.data.unwrap(), expected);
    }

    #[test]
    fn test_write_creates_parents_under_granted_root() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grant(&[dir.path()]);
        let target = dir.path().join("nested").join("deep").join("file.txt");

        let resp = write_text_file_impl(&grants, &target.to_string_lossy(), "nested".to_string());
        assert!(resp.success);

        let content = std::fs::read_to_string(&target).unwrap();
        assert_eq!(content, "nested");
    }

    #[test]
    fn test_write_denied_outside_granted_roots_leaves_no_dirs() {
        let granted = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let target = other.path().join("created-by-attack").join("out.txt");

        let grants = grant(&[granted.path()]);
        let resp = write_text_file_impl(&grants, &target.to_string_lossy(), "x".to_string());
        assert!(!resp.success);
        assert!(resp.error.unwrap().message.contains("Access denied"));
        assert!(!target.exists());
        assert!(!other.path().join("created-by-attack").exists());
    }

    #[test]
    fn test_parent_dir_in_missing_tail_is_denied() {
        // `Path::file_name` returns None for a trailing `..`, so any
        // ".." in the unresolved tail makes lenient_canonicalize give up
        // and the access check fails before the OS ever sees the path.
        // Without that, `<root>/missing/../../outside` would pass the
        // literal starts_with prefix check while kernel resolution of
        // `..` escapes the granted root.
        let dir = tempfile::tempdir().unwrap();
        let escape = dir
            .path()
            .join("missing")
            .join("..")
            .join("..")
            .join("evil.txt");
        assert!(lenient_canonicalize(&escape).is_none());

        let grants = grant(&[dir.path()]);
        let resp = write_text_file_impl(&grants, &escape.to_string_lossy(), "x".to_string());
        assert!(!resp.success);
    }

    #[test]
    fn test_lenient_canonicalize_resolves_missing_tail() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("new-sub").join("f.txt");
        let resolved = lenient_canonicalize(&target).expect("resolves against existing root");
        let canon_root = dir.path().canonicalize().unwrap();
        assert!(resolved.starts_with(&canon_root));
        assert_eq!(
            resolved.strip_prefix(&canon_root).unwrap(),
            Path::new("new-sub").join("f.txt")
        );
    }

    #[test]
    fn test_fs_error_response_structure() {
        let resp: ApiResponse<String> = ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                "test error",
            )),
        };
        assert!(!resp.success);
        assert!(resp.data.is_none());
        assert_eq!(resp.error.unwrap().code, error_codes::FILE_SYSTEM_ERROR);
    }

    #[test]
    fn test_write_overwrites_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("existing.txt");
        std::fs::write(&target, "old content that is longer than new").unwrap();

        let grants = grant(&[dir.path()]);
        let resp = write_text_file_impl(&grants, &target.to_string_lossy(), "new".to_string());
        assert!(resp.success);

        // Truncate semantics: the file must contain exactly the new content,
        // not a prefix of the old content.
        let content = std::fs::read_to_string(&target).unwrap();
        assert_eq!(content, "new");
    }

    #[test]
    fn test_write_to_newly_created_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("brand-new.txt");
        assert!(!target.exists());

        let grants = grant(&[dir.path()]);
        let resp = write_text_file_impl(&grants, &target.to_string_lossy(), "fresh".to_string());
        assert!(resp.success);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "fresh");
    }

    #[test]
    fn test_write_denied_for_ungranted_path() {
        let granted = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let target = other.path().join("out.txt");

        let grants = grant(&[granted.path()]);
        let resp = write_text_file_impl(&grants, &target.to_string_lossy(), "x".to_string());
        assert!(!resp.success);
        assert!(resp.error.unwrap().message.contains("Access denied"));
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn test_write_denied_through_symlink_escape() {
        use std::os::unix::fs::symlink;

        let granted = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_target = outside.path().join("secret.txt");
        // The target must already exist so `lenient_canonicalize` resolves the
        // symlink to its canonical (outside) location and the grant check
        // denies it.
        std::fs::write(&outside_target, "original").unwrap();

        // A symlink inside the granted root pointing outside it.
        let link = granted.path().join("escape-link");
        symlink(&outside_target, &link).unwrap();

        let grants = grant(&[granted.path()]);
        let resp = write_text_file_impl(&grants, &link.to_string_lossy(), "pwned".to_string());
        assert!(!resp.success);
        // The outside file must not have been overwritten.
        assert_eq!(
            std::fs::read_to_string(&outside_target).unwrap(),
            "original"
        );
    }
}
