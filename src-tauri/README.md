# Musaed Rust Backend (`src-tauri`)

The Rust backend for Musaed — a Tauri 2 application serving as the system truth layer for Ollama chat, RAG, conversation persistence, and SQLite migrations. All filesystem access and external process communication happens here; the frontend has no direct filesystem or network visibility.

## Architecture

```
src-tauri/
├── Cargo.toml            # Crate: musaed (lib name: musaed_lib)
├── tauri.conf.json       # Tauri config (productName: Musaed, identifier: com.musaed.desktop)
├── build.rs              # Tauri build script (specta type generation)
└── src/
    ├── main.rs           # Entry point (calls musaed_lib::run())
    ├── lib.rs            # App setup — plugins, state, command registration, tray, menu bar
    ├── app_info.rs       # App version command
    ├── context_menu.rs   # Native context menu
    ├── dialog.rs         # File/dialog commands (ask, open_file, save_file)
    ├── fs_commands.rs    # Filesystem commands (read_file, read_text_file, write_text_file)
    ├── opener.rs         # URL opener command
    ├── store_commands.rs # Tauri plugin-store commands (load, get, set, save, delete)
    ├── rate_limiter.rs   # Rate limiting for IPC commands
    ├── shared.rs         # Shared utilities (cache eviction, shutdown coordination)
    ├── validation.rs     # Stateless input-validation helpers
    ├── generated_validation.rs # Generated validation constants (codegen)
    ├── error_codes.rs    # Error code definitions
    ├── payloads.rs       # Shared request/response payload types
    ├── ollama_url.rs     # Ollama URL parsing/normalization
    ├── tray.rs           # System tray + close-to-tray background task protection
    ├── menu_bar.rs       # Native macOS menu bar with i18n labels
    ├── ollama/           # Ollama engine domain
    │   ├── mod.rs
    │   ├── commands.rs   # chat, abort, check_health commands
    │   ├── service.rs    # Chat streaming service
    │   ├── streaming.rs   # Stream processing + backpressure
    │   ├── abort_service.rs # Stream cancellation
    │   ├── health_service.rs
    │   ├── model_service.rs
    │   ├── title_service.rs
    │   ├── title.rs       # Title generation command
    │   └── models.rs      # Model management commands (get, pull, delete, validate)
    ├── rag/              # RAG domain
    │   ├── mod.rs
    │   ├── commands.rs   # All cmd_rag_* Tauri commands
    │   ├── indexing.rs   # Async + cancellable indexing pipeline
    │   ├── search.rs     # Hybrid BM25 + vector search
    │   ├── bm25.rs       # BM25 ranking
    │   ├── embedder.rs   # Embedding generation
    │   ├── chunker.rs    # AST-aware code chunking (tree-sitter)
    │   ├── context_assembler.rs # Token-budget-aware context assembly
    │   ├── ignore.rs     # .gitignore-aware file traversal
    │   ├── validation.rs  # RAG input validation
    │   ├── error.rs
    │   ├── types.rs
    │   ├── services/     # RAG services (project management)
    │   └── store/        # RAG SQLite store (connection, projects, files, chunks, embeddings, stats)
    ├── conversation/     # Conversation domain
    │   ├── mod.rs
    │   ├── commands.rs   # CRUD + search commands
    │   ├── service.rs    # Business logic
    │   ├── store.rs      # ConversationStore (SQLite)
    │   ├── connection.rs # DB connection + schema version
    │   └── models.rs     # Conversation/message models
    ├── migrations/       # Schema migration framework
    │   ├── mod.rs        # Orchestrator (run_migrations, rollback_to_version)
    │   ├── version_tracker.rs
    │   ├── service.rs
    │   ├── commands.rs   # Tauri commands (run, rollback, status, list)
    │   └── conversations/ # Conversation DB migrations (v1–v5)
    └── logging/         # Structured logging & tracing
        ├── mod.rs
        ├── commands.rs   # Log + trace commands
        ├── logger.rs     # File logger + tracing layer
        ├── service.rs
        ├── sanitizer.rs  # PII sanitizer
        └── tokens.rs     # Log clear tokens
```

## Domain structure

Each domain follows the same pattern: commands are thin adapters, business logic lives in services, persistence lives in stores.

| Domain          | Modules                          | Store type               | Schema versions |
| --------------- | -------------------------------- | ------------------------ | --------------- |
| `ollama/`       | chat, streaming, models, health  | Stateless (HTTP client)  | —               |
| `rag/`          | indexing, search, embedder        | `RagStore` (SQLite)      | v1–v3           |
| `conversation/` | CRUD, search                      | `ConversationStore` (SQLite) | v1–v3      |
| `migrations/`    | run, rollback, version tracking   | — (operates on DBs)      | —               |
| `logging/`      | trace, file logger, sanitizer     | — (in-memory + file)      | —               |

## State management

Rust state is managed via Tauri's `app.manage()`:

- `Arc<Mutex<ConversationStore>>` — write-heavy, mutex-protected
- `Arc<RwLock<RagStore>>` — read-heavy, RwLock-protected

This follows the canonical service pattern (see `STANDARDS.md §6 SERVICE PATTERN`).

## IPC commands

All commands are registered in `lib.rs` via `tauri::generate_handler![]`. Every command:

- Is a thin adapter (no business logic)
- Takes typed request structs
- Returns `ApiResponse<T>` or `Result<ApiResponse<T>, BackendError>`
- Validates all inputs

Command names follow the `cmd_<domain>_<action>` convention and are mirrored in the TypeScript `COMMAND_VERSIONS` registry (`packages/contracts/src/command-versions.ts`).

## Migration system

Musaed uses a code-based (not SQL file) migration framework. Migrations are Rust functions that execute SQL within transactions, with version tracking stored in SQLite metadata tables (`_conversations_migrations`).

The conversation database is at schema version **5**. The RAG database manages its own schema inline in `rag/store/connection.rs` (not through this framework).

- Migrations run automatically on app startup
- Rollback support for rollbackable migrations
- Idempotent execution (safe to re-run)
- Frontend can drive migrations via `cmd_run_migrations`, `cmd_rollback_migrations`, `cmd_get_migration_status`, `cmd_list_migrations`

See `docs/migration-framework.md` for detailed documentation.

## Tauri configuration

```json
{
  "productName": "Musaed",
  "identifier": "com.musaed.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter web dev",
    "beforeBuildCommand": "pnpm --filter web build",
    "frontendDist": "../apps/web/out"
  },
  "app": {
    "windows": [{ "title": "Musaed", "width": 1000, "height": 700, "titleBarStyle": "Overlay" }]
  }
}
```

### Tauri plugins

- `tauri-plugin-dialog` — native file/open/save dialogs, confirmation prompts
- `tauri-plugin-fs` — filesystem read/write
- `tauri-plugin-opener` — open URLs in system browser
- `tauri-plugin-store` — key-value JSON persistence (Zustand stores)
- `tauri-plugin-single-instance` — single instance enforcement

## Development

```bash
# Full Tauri dev (frontend + backend)
pnpm dev

# Rust-only checks
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

## Testing

Integration tests live in `src-tauri/tests/`:

- `integration_conversation.rs` — conversation store integration tests
- `integration_ollama.rs` — Ollama integration tests (may require a running Ollama instance)
- `hybrid_search.rs` — RAG hybrid search correctness tests

Unit tests are `#[cfg(test)]` modules within each source file.

## Related documentation

- [Root README](../README.md)
- [STANDARDS.md §6 — Rust Architecture Rules](../STANDARDS.md)
- [Migration Framework](../docs/migration-framework.md)
- [Tauri IPC Enforcement](../docs/tauri-ipc-enforcement.md)
- [Structured Logging](../docs/structured-logging.md)
