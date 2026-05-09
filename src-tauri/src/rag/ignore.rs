//! .gitignore-aware file walker configuration for RAG indexing.
//!
//! Uses the `ignore` crate (ripgrep's walker) to traverse project directories
//! while respecting .gitignore, .ignore, and custom patterns.

use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use std::path::{Path, PathBuf};
use tracing;

// ====================== DEFAULT IGNORE PATTERNS ======================

/// Patterns that are always excluded from indexing.
const ALWAYS_IGNORE: &[&str] = &[
    // Version control
    ".git",
    ".svn",
    ".hg",
    // Dependency directories
    "node_modules",
    "vendor",
    ".venv",
    "venv",
    "env",
    "__pypackages__",
    // Build output
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".output",
    "bin",
    "obj",
    // IDE / editor
    ".idea",
    ".vscode",
    "*.swp",
    "*.swo",
    // OS artifacts
    ".DS_Store",
    "Thumbs.db",
    // Secrets / sensitive
    ".env",
    ".env.*",
    "**/secrets/**",
    "**/credentials/**",
    "**/*.pem",
    "**/*.key",
    // Binary files
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.ico",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.mp3",
    "*.mp4",
    "*.zip",
    "*.gz",
    "*.tar",
    "*.so",
    "*.dll",
    "*.dylib",
    "*.exe",
    "*.o",
    "*.a",
    "*.lib",
    "*.pyc",
    "*.class",
    "*.jar",
    "*.wasm",
    // Lock files
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "Gemfile.lock",
    "Cargo.lock",
    // Large data files
    "*.sqlite3",
    "*.db",
    "*.parquet",
    "*.csv",
    // Log files
    "*.log",
];

/// Maximum file size to index (1 MB). Larger files are skipped.
const MAX_FILE_SIZE: u64 = 1024 * 1024;

/// Maximum number of files to index per project (safety cap).
const MAX_FILES_PER_PROJECT: usize = 50_000;

/// Binary file check: read first 8KB and look for null bytes.
const BINARY_CHECK_SIZE: usize = 8192;

// ====================== FILE DISCOVERY ======================

/// Result of file discovery.
#[derive(Debug, Clone)]
pub struct DiscoveredFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub size: u64,
}

/// Walk a project directory respecting ignore patterns.
/// Returns a list of discoverable files with their sizes.
pub fn discover_files(
    project_path: &Path,
    extra_ignore_patterns: &[String],
) -> Result<Vec<DiscoveredFile>, String> {
    if !project_path.exists() {
        return Err(format!("Project path does not exist: {:?}", project_path));
    }
    if !project_path.is_dir() {
        return Err(format!(
            "Project path is not a directory: {:?}",
            project_path
        ));
    }

    let mut builder = WalkBuilder::new(project_path);
    builder
        .hidden(false) // Include hidden files (user may want to index .config files)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .follow_links(false)
        .max_filesize(Some(MAX_FILE_SIZE));

    // Add always-ignore patterns
    let mut override_builder = OverrideBuilder::new(project_path);
    for pattern in ALWAYS_IGNORE {
        override_builder
            .add(&format!("!{}", pattern))
            .map_err(|e| format!("Invalid ignore pattern '{}': {}", pattern, e))?;
    }

    // Add user-provided extra ignore patterns
    for pattern in extra_ignore_patterns {
        override_builder
            .add(&format!("!{}", pattern))
            .map_err(|e| format!("Invalid ignore pattern '{}': {}", pattern, e))?;
    }

    let overrides = override_builder
        .build()
        .map_err(|e| format!("Failed to build ignore overrides: {}", e))?;

    builder.overrides(overrides);

    let mut files = Vec::new();
    let walker = builder.build();

    for entry in walker {
        match entry {
            Ok(entry) => {
                if files.len() >= MAX_FILES_PER_PROJECT {
                    tracing::warn!(
                        "File limit reached ({}) for project {:?}. Remaining files skipped.",
                        MAX_FILES_PER_PROJECT,
                        project_path
                    );
                    break;
                }

                if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                    continue;
                }

                let path = entry.path().to_path_buf();
                let relative = path
                    .strip_prefix(project_path)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let metadata = match std::fs::metadata(&path) {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::debug!("Skipping file {:?}: {}", path, e);
                        continue;
                    }
                };

                // Skip empty files
                if metadata.len() == 0 {
                    continue;
                }

                // Check if the file appears to be binary
                if is_binary_file(&path) {
                    tracing::debug!("Skipping binary file: {:?}", path);
                    continue;
                }

                files.push(DiscoveredFile {
                    path,
                    relative_path: relative,
                    size: metadata.len(),
                });
            }
            Err(e) => {
                tracing::debug!("Walk error: {}", e);
            }
        }
    }

    tracing::info!("Discovered {} files in {:?}", files.len(), project_path);

    Ok(files)
}

/// Check if a file appears to be binary by reading the first few KB and looking
/// for null bytes.
fn is_binary_file(path: &Path) -> bool {
    match std::fs::File::open(path) {
        Ok(mut file) => {
            use std::io::Read;
            let mut buf = [0u8; BINARY_CHECK_SIZE];
            match file.read(&mut buf) {
                Ok(n) => {
                    let slice = &buf[..n];
                    slice.contains(&0)
                }
                Err(_) => true,
            }
        }
        Err(_) => true,
    }
}

/// Check if a file extension is supported for text-based indexing.
pub fn is_text_file(path: &Path) -> bool {
    match path.extension() {
        Some(ext) => {
            let ext_str = ext.to_string_lossy().to_lowercase();
            // Check against the binary extensions in ALWAYS_IGNORE
            let binary_exts = [
                "png", "jpg", "jpeg", "gif", "webp", "ico", "woff", "woff2", "ttf", "eot", "mp3",
                "mp4", "zip", "gz", "tar", "so", "dll", "dylib", "exe", "o", "a", "lib", "pyc",
                "class", "jar", "wasm",
            ];
            !binary_exts.contains(&ext_str.as_str())
        }
        None => true, // No extension — could be a text file (e.g., Makefile)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn setup_test_dir() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("musaed_rag_ignore_test_{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(dir.join(".git/objects")).unwrap();
        fs::create_dir_all(dir.join("dist")).unwrap();

        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join("src/lib.rs"), "pub fn lib() {}").unwrap();
        fs::write(dir.join("node_modules/pkg/index.js"), "module.exports = {}").unwrap();
        fs::write(dir.join(".git/objects/abc"), "git object").unwrap();
        fs::write(dir.join("dist/bundle.js"), "compiled bundle").unwrap();
        fs::write(dir.join("README.md"), "# Test").unwrap();

        dir
    }

    #[test]
    fn test_discover_files_respects_gitignore() {
        let dir = setup_test_dir();
        let files = discover_files(&dir, &[]).unwrap();

        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();

        // Should include source files
        assert!(paths.iter().any(|p| p.contains("main.rs")));
        assert!(paths.iter().any(|p| p.contains("README.md")));

        // Should NOT include node_modules or .git or dist
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.contains(".git")));
        assert!(!paths.iter().any(|p| p.contains("dist")));

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_discover_files_extra_ignore_patterns() {
        let dir = setup_test_dir();
        let files = discover_files(&dir, &["*.rs".to_string()]).unwrap();

        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();

        // .rs files should be excluded by extra pattern
        assert!(!paths.iter().any(|p| p.ends_with(".rs")));

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_discover_nonexistent_path() {
        let result = discover_files(Path::new("/nonexistent/path/12345"), &[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_is_text_file() {
        assert!(is_text_file(Path::new("main.rs")));
        assert!(is_text_file(Path::new("config.json")));
        assert!(!is_text_file(Path::new("image.png")));
        assert!(!is_text_file(Path::new("lib.dll")));
    }
}
