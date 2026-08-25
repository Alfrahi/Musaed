use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

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

    fn is_granted(&self, resolved: &Path) -> bool {
        self.lock().iter().any(|root| resolved.starts_with(root))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<PathBuf>> {
        // Recover from poisoning rather than panicking into the UI (§13).
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Canonicalizes `path`, resolving symlinks down to the deepest existing
/// ancestor and re-appending any not-yet-existing tail components, so that
/// fresh save-dialog targets still compare correctly against granted roots.
///
/// Both grant-time and access-time go through this function, keeping the
/// Windows verbatim-path prefix (`\\?\`) consistent on both sides of the
/// prefix comparison.
fn lenient_canonicalize(path: &Path) -> Option<PathBuf> {
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
fn require_granted_file(grants: &FsAccessGrants, raw: &str) -> Result<PathBuf, FsAccessError> {
    let resolved = authorize(grants, raw)?;
    if !resolved.exists() {
        return Err(FsAccessError::Unresolvable(raw.to_string()));
    }
    if !resolved.is_file() {
        return Err(FsAccessError::NotAFile(raw.to_string()));
    }
    Ok(resolved)
}

fn read_text_file_impl(grants: &FsAccessGrants, path: &str) -> ApiResponse<String> {
    let resolved = match require_granted_file(grants, path) {
        Ok(p) => p,
        Err(e) => return failure(e),
    };

    match std::fs::read_to_string(&resolved) {
        Ok(content) => ApiResponse {
            success: true,
            data: Some(content),
            error: None,
        },
        Err(e) => io_failure("read file", path, e),
    }
}

fn read_file_base64_impl(grants: &FsAccessGrants, path: &str) -> ApiResponse<String> {
    let resolved = match require_granted_file(grants, path) {
        Ok(p) => p,
        Err(e) => return failure(e),
    };

    match std::fs::read(&resolved) {
        Ok(bytes) => {
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

fn write_text_file_impl(grants: &FsAccessGrants, path: &str, content: String) -> ApiResponse<bool> {
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

    match std::fs::write(&resolved, content) {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => io_failure("write file", path, e),
    }
}

/// Reads a text file from a user-granted location and returns its contents
/// as a string.
#[tauri::command]
pub async fn cmd_fs_read_text_file(
    grants: State<'_, FsAccessGrants>,
    path: String,
) -> Result<ApiResponse<String>, String> {
    Ok(read_text_file_impl(grants.inner(), &path))
}

/// Reads a binary file from a user-granted location and returns its contents
/// base64-encoded.
#[tauri::command]
pub async fn cmd_fs_read_file(
    grants: State<'_, FsAccessGrants>,
    path: String,
) -> Result<ApiResponse<String>, String> {
    Ok(read_file_base64_impl(grants.inner(), &path))
}

/// Writes text content to a file inside a user-granted location.
#[tauri::command]
pub async fn cmd_fs_write_text_file(
    grants: State<'_, FsAccessGrants>,
    path: String,
    content: String,
) -> Result<ApiResponse<bool>, String> {
    Ok(write_text_file_impl(grants.inner(), &path, content))
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
}
