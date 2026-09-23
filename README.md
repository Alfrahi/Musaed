# Musaed

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB.svg?logo=tauri)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react)](https://reactjs.org/)
[![Rust](https://img.shields.io/badge/Rust-2021%20edition-DEA584.svg?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/Local%20AI-Ollama-black.svg)](https://ollama.com/)

> 🇾🇪 **متوفر باللغة العربية:** يمكنك الاطلاع على هذه الصفحة باللغة العربية [عبر هذا الرابط](README.ar.md).

A privacy-first, fully offline native desktop AI assistant built on **Tauri 2**, **Next.js 16 (App Router)**, **React 19**, and **Rust**. Powered by local **Ollama** instances, Musaed provides streaming AI completions, offline Retrieval-Augmented Generation (RAG) with AST-aware code chunking and hybrid BM25/vector search, internationalization with Arabic (RTL) support, and SQLite persistence with transactional migrations—operating with zero telemetry and zero external network calls.

---

## Features

- **Local AI & Real-Time Chat Engine**:
  - Streaming chat completions directly from local Ollama instances with backpressure control and stream cancellation.
  - Multi-turn conversation sessions with automatic title generation from message context.
  - Rich Markdown & media rendering: LaTeX formulas via KaTeX, dynamic diagrams via Mermaid, syntax-highlighted code blocks with copy-to-clipboard, and collapsible reasoning blocks for thinking models.
  - Message list virtualization powered by `react-virtuoso` for smooth scrolling in long conversations.
  - Interactive message controls: inline edit-and-resend for user messages, single-message deletion, and file attachment support.
- **Local RAG (Retrieval-Augmented Generation)**:
  - **Multi-Project Workspaces**: Index local codebases and document collections with `.gitignore`-aware file traversal via the Rust `ignore` crate.
  - **AST-Aware Semantic Code Chunking**: Syntax-tree-aware chunking powered by `tree-sitter` supporting 9 languages (Rust, TypeScript/JavaScript, Python, Java, Go, C, C++, JSON, YAML), alongside heading-based Markdown chunking and sliding-window plain text chunking.
  - **Embedded Vector Store**: Local high-dimensional embedding storage and similarity indexing powered by SQLite with `sqlite-vec` via `rusqlite`.
  - **Hybrid Retrieval Engine**: Combines vector cosine similarity (`sqlite-vec`) and lexical BM25 ranking via a weighted linear formula (0.6 vector weight / 0.4 saturating BM25 score).
  - **Context Assembly & Citation Tracking**: Formats retrieved code and text chunks into structured system context within a configurable character budget (`MAX_RAG_CONTEXT_CHARS`), preserving source file paths, line ranges, and citations.
  - **Deduplication & Incremental Indexing**: Fast file and chunk content hashing via `xxhash-rust` (XXH3) to skip unchanged content during re-indexing.
  - **Non-Blocking Background Pipeline**: Asynchronous, cancellable indexing pipeline reporting real-time progress events.
- **Ollama Model Management**:
  - Model library browser to inspect installed Ollama models, pull new models with progress tracking, and delete models.
  - Real-time download progress tracking with byte-level streaming updates and cancellation support.
  - Per-model sampling parameters (temperature, top-p, context length) via `ModelParamsPanel`.
  - Model switching with active stream abort on unmount or switch to prevent orphaned requests.
- **Conversation Organization & Search**:
  - Chronologically grouped sidebar history (Today, Yesterday, Previous 7 Days, Older).
  - Conversation management: create new conversations, rename, delete, clear all, and export.
  - Clean Markdown export with conversation title, model name, creation timestamp, message roles, sanitized content, and token generation speed statistics.
  - Message-level full-text search across all conversations via SQLite FTS5 (trigram index) with debounced search modal and keyboard navigation.
- **Desktop Native & System Shell**:
  - Cross-platform native window management powered by Tauri 2.
  - System tray integration with background task protection (intercepts window close to minimize to tray when chat streams, model pulls, or RAG indexing are active).
  - Native macOS menu bar with localized bilingual menus via `cmd_menu_rebuild`.
  - Single-instance locking via `tauri-plugin-single-instance`.
  - Native operating system file pickers for folder selection, file attachments, and Markdown exports.
  - Hardened security controls including path traversal guards (`path_guard.rs`), input validation, and IPC command rate limiting (`rate_limiter.rs`).
- **Bilingual & RTL-First User Interface**:
  - Localization supporting English (LTR) and Arabic (RTL).
  - Arabic typography using the `Tajawal` font stack.
  - Context-aware icon mirroring (`.mirror-rtl`) for directional navigation and controls.
  - Automated translation key checks (`pnpm i18n:check`) and Playwright visual regression tests covering RTL layouts.
- **Architectural Invariants & Data Integrity**:
  - Domain-Driven Design (DDD) frontend modules gated by machine-validated manifests (`feature.manifest.ts`).
  - Centralized IPC bridge (`apps/web/src/lib/ipc.ts`) preventing unauthorized Tauri calls or internal leaks.
  - Strict compile-time and CI contract alignment (`pnpm validate:contracts --strict`) between Rust commands and TypeScript interfaces.
  - Transactional, code-based SQLite migration framework with automated version tracking (Conversation DB v7, RAG DB v5) and rollback support for reversible conversation migrations.
  - Structured logging with trace IDs, IPC latency statistics, error redaction, and log sanitization.

---

## User Interface & Screenshots

### Arabic (RTL)

|               Homepage & Chat               |               Model Library               |           Settings & Preferences            |
| :-----------------------------------------: | :---------------------------------------: | :-----------------------------------------: |
| ![AR Homepage](screenshots/AR-Homepage.png) | ![AR Library](screenshots/AR-Library.png) | ![AR Settings](screenshots/AR-Settings.png) |

### English (LTR)

|               Homepage & Chat               |               Model Library               |           Settings & Preferences            |
| :-----------------------------------------: | :---------------------------------------: | :-----------------------------------------: |
| ![EN Homepage](screenshots/EN-Homepage.png) | ![EN Library](screenshots/EN-Library.png) | ![EN Settings](screenshots/EN-Settings.png) |

---

## Tech Stack

| Layer                              | Technology                                                                     |
| :--------------------------------- | :----------------------------------------------------------------------------- |
| **Desktop Application Shell**      | Tauri 2.0.0-rc.0 (Rust 2021 Edition)                                           |
| **Frontend Framework**             | Next.js 16.3.5 (App Router, Static Export), React 19.3.0, TypeScript 5.9.3     |
| **Styling & Animation**            | Tailwind CSS 4.3.3, Lucide React 1.46.0, Framer Motion 12.38.0                 |
| **State Management**               | Zustand 5.0.15 (8 domain-scoped stores in `apps/web/src/store/`)               |
| **Local AI Inference**             | Ollama HTTP API (Localhost streaming, model pull, health checks)               |
| **Markdown & Rich Content**        | React Markdown 9.0.3, KaTeX 0.18.7, Mermaid 11.16.1, highlight.js 11.12.0      |
| **UI Virtualization**              | React Virtuoso 4.18.13                                                         |
| **Vector Store & Database**        | SQLite (Bundled `rusqlite` 0.40), `sqlite-vec` 0.1                             |
| **Code Chunking & File Traversal** | Tree-sitter 0.26 (9 language grammars), `ignore` 0.4 (Ripgrep engine)          |
| **Search & Deduplication**         | Custom BM25 ranking + SQLite FTS5 (trigram), `xxhash-rust` 0.8 (XXH3 hashing)  |
| **Contracts & Validation**         | Shared `@musaed/contracts`, Zod 4.6.5, Specta 2.0                              |
| **Testing & CI Quality**           | Vitest 5.0.0, Playwright 1.63.0, Cargo Test, Clippy, dependency-cruiser 18.3.0 |

---

## Getting Started

### Prerequisites

- **Node.js**: `v22.x` or higher
- **pnpm**: `v11.x` or higher (`pnpm` is strictly required)
- **Rust**: Stable toolchain (`rustc`, `cargo`, `rustfmt`, `clippy`)
- **Ollama**: Installed and running locally ([ollama.com](https://ollama.com))
- **System Libraries (Linux)**:
  ```bash
  sudo apt-get update && sudo apt-get install -y \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev
  ```

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Local Ollama Model

Ensure Ollama is running and download your preferred model:

```bash
# Start Ollama service (if not already running as a daemon)
ollama serve

# Pull a recommended conversational or coding model
ollama pull llama3.2
# or
ollama pull qwen2.5-coder
```

### 3. Run Development Server

To launch the full desktop application (Next.js frontend + Tauri Rust backend):

```bash
pnpm dev
```

If you want to run only the Next.js web UI preview in the browser:

```bash
pnpm dev:web
```

### 4. Build for Production

To validate all architectural rules, run i18n checks, build the static export, and compile the native Tauri binary:

```bash
pnpm prod:build
```

The resulting native executable and distribution bundles will be located in `src-tauri/target/release/bundle/`.

---

## Available Commands

All scripts are executed via `pnpm` and `cargo`:

| Command                                                                                         | Description                                                                             |
| :---------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `pnpm dev`                                                                                      | Starts Tauri development mode (launches Next.js dev server + Rust backend)              |
| `pnpm dev:web`                                                                                  | Runs the Next.js development server only (in browser, without Tauri backend)            |
| `pnpm build`                                                                                    | Compiles the Tauri production binary                                                    |
| `pnpm prod:build`                                                                               | Full production build: executes validation, i18n check, static export, and Tauri build  |
| `pnpm test`                                                                                     | Runs frontend unit tests via Vitest                                                     |
| `pnpm --filter web test:integration`                                                            | Runs frontend integration tests via Vitest                                              |
| `pnpm lint`                                                                                     | Runs ESLint across `apps/web/src`                                                       |
| `pnpm type-check`                                                                               | Runs TypeScript compiler checks across all workspace projects                           |
| `pnpm arch-check`                                                                               | Validates architectural boundaries and feature imports with dependency-cruiser          |
| `pnpm validate`                                                                                 | Executes linting, type-checking, i18n checks, and feature manifest validation           |
| `pnpm validate:contracts --strict`                                                              | Verifies strict contract alignment between Rust commands and TypeScript interfaces      |
| `pnpm validate:acl`                                                                             | Ensures 100% IPC command-to-permission mapping coverage                                 |
| `pnpm validate:manifests`                                                                       | Validates feature manifest consistency and public API exports                           |
| `pnpm codegen:feature-deps`                                                                     | Generates feature dependency graph metadata from manifests                              |
| `pnpm codegen:validation`                                                                       | Generates validation limits and constants shared with Rust                              |
| `pnpm i18n:sync`                                                                                | Synchronizes translation keys between `en.json` and `ar.json`                           |
| `pnpm i18n:check`                                                                               | Validates translation completeness with zero tolerance for missing keys                 |
| `pnpm gate`                                                                                     | Complete local CI gate: runs validation, contracts, ACL, tests, clippy, and cargo tests |
| `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`                               | Checks Rust code formatting                                                             |
| `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` | Runs Rust lints with zero-warning tolerance                                             |
| `cargo test --manifest-path src-tauri/Cargo.toml`                                               | Executes all Rust unit and integration tests                                            |

---

## Architecture & Codebase Layout

Musaed is architected as a modular monorepo enforcing strict boundary isolation:

```text
musaed/
├── apps/
│   └── web/                   # Next.js 16 (App Router, static export) UI application
│       ├── locales/           # Bilingual translation dictionaries (en.json, ar.json)
│       ├── src/
│       │   ├── app/           # Next.js app routes, layout, and global providers
│       │   ├── features/      # Domain-Driven Design (DDD) feature modules
│       │   ├── lib/           # Centralized IPC bridge (ipc.ts), i18n engine, and utilities
│       │   ├── store/         # 8 domain-scoped Zustand stores
│       │   └── styles/        # Tailwind v4 styles, custom typography, and animations
│       └── e2e/               # Playwright visual regression tests (RTL and LTR)
├── packages/
│   └── contracts/             # Shared TypeScript contracts, Zod schemas, and IPC registry
├── src-tauri/                 # Tauri 2 Rust backend
│   ├── Cargo.toml             # Rust dependencies (rusqlite, tree-sitter, reqwest, tokio)
│   └── src/
│       ├── conversation/      # Conversation domain service, SQLite store, and commands
│       ├── rag/               # RAG domain (Tree-sitter chunker, BM25, sqlite-vec, embedder)
│       ├── ollama/            # Ollama streaming client, abort controller, model manager
│       ├── migrations/        # Code-based SQLite migration framework (conversations & RAG)
│       ├── logging/           # Structured tracing, file logger, and log sanitization
│       ├── fs/                # Guarded filesystem commands
│       └── lib.rs             # Tauri command registration and application lifecycle
├── docs/                      # Authoritative architecture and operational guides
├── scripts/                   # CI verification, contract validation, and codegen scripts
└── STANDARDS.md               # Definitive engineering standards and invariants
```

### System Layers

1. **Frontend Layer** (`apps/web`): React 19 UI shell, Tailwind CSS v4, Zustand state stores.
2. **IPC Bridge** (`apps/web/src/lib/ipc.ts`): The sole authorized conduit for frontend-to-native communication. Direct calls to `window.__TAURI__` are strictly prohibited.
3. **Contracts Layer** (`packages/contracts`): Authoritative TypeScript types, Zod validation schemas, IPC command definitions, and latency budgets.
4. **Rust Truth Layer** (`src-tauri`): High-performance native engine managing Ollama streaming, SQLite persistence, RAG indexing, and OS interactions.
5. **Memory Stores Layer**: 8 specialized, domain-scoped Zustand stores (`conversation`, `library`, `rag`, `settings`, etc.) with immutable mutation policies.

### Feature Modules (DDD)

The frontend is decomposed into 8 isolated feature modules under `apps/web/src/features/`. Each feature exports a deliberate public API (`index.ts`) and is guarded by a machine-validated manifest (`feature.manifest.ts`):

| Feature        | Responsibility                                                                               |
| :------------- | :------------------------------------------------------------------------------------------- |
| `conversation` | Chat with Ollama — streaming completions, message persistence, attachments, reasoning blocks |
| `sidebar`      | Conversation timeline list, grouping (Today/Yesterday/etc.), export to Markdown              |
| `library`      | Ollama model management — browse, pull with progress, inspect parameters, delete             |
| `rag`          | Local RAG — project workspaces, file indexing, AST chunking, hybrid search, context assembly |
| `settings`     | Application configuration — Ollama URL, theme, language, local storage, migrations           |
| `search`       | Instant full-text search across all stored conversations and messages                        |
| `info`         | About dialog — versioning, release notes, license, and architectural information             |
| `layout`       | Composition root — mounts all features and orchestrates the application shell                |

Cross-feature imports are automatically verified by `dependency-cruiser` in CI; unauthorized imports fail the build immediately.

---

## Testing & Quality Assurance

Musaed maintains automated test suites across all layers:

```bash
# Run complete test and lint suite locally
pnpm gate
```

### 1. Frontend Unit & Integration Testing

Powered by **Vitest** and **React Testing Library**:

- Unit tests co-located with feature components and hooks.
- Integration tests simulating IPC bridge responses, Zustand store updates, and streaming lifecycle.

### 2. Visual Regression Testing (RTL / LTR)

Powered by **Playwright**:

- Automated browser snapshots verifying Arabic RTL layouts, font rendering (`Tajawal`), and icon mirroring.
- Blocking CI job preventing unintended layout shifts or directionality regressions.

### 3. Rust Backend Testing

Powered by **Cargo Test**:

- Unit tests across RAG indexing, BM25 scoring, AST chunking, and path sanitization.
- Integration tests verifying SQLite schema migrations, rollback mechanisms, and Ollama streaming backpressure.

### 4. Continuous Integration (CI) Workflow

Every commit and pull request is verified by a 5-stage GitHub Actions pipeline (`.github/workflows/ci.yml`):

1. **Validate**: ESLint, TypeScript `type-check`, boundary analysis (`arch-check`), i18n parity, contract alignment (`validate:contracts --strict`), IPC ACL mapping, and no-TODO checks.
2. **Test**: Frontend unit & integration tests, plus `pnpm audit` (fails on moderate+ advisories).
3. **Rust**: `cargo fmt`, `cargo clippy` (-D warnings), `cargo test`, and `cargo audit` (RustSec advisory database).
4. **Visual Tests**: Playwright visual regression tests covering Arabic RTL and English LTR views.
5. **Build**: Static export validation and full native Tauri build compilation.

---

## Architecture & Technical Documentation

For in-depth architectural specifications and subsystem guides, refer to:

- [Engineering Standards (STANDARDS.md)](./STANDARDS.md) — The authoritative system specification (mandatory reading for contributors)
- [SQLite Migration Framework](docs/migration-framework.md) — Code-based transactional database migration system
- [Tauri IPC Enforcement](docs/tauri-ipc-enforcement.md) — Typed contract alignment and IPC security rules
- [Structured Logging & Observability](docs/structured-logging.md) — Trace-based observability and log sanitization
- [Deployment on Network Filesystems](docs/deployment-network-fs.md) — SQLite locking protocols and data safety on network shares
- [Shared Contracts Package](packages/contracts/README.md) — TypeScript contracts and IPC command registry
- [Rust Backend Documentation](src-tauri/README.md) — Architecture of `src-tauri` services, stores, and commands
- **Feature Documentation**: Individual README files located in each `apps/web/src/features/*/README.md`

---

## Security & Privacy Guarantees

- **Zero Network Telemetry**: Musaed makes zero external network requests. All LLM operations communicate strictly with local loopback endpoints (e.g., `http://127.0.0.1:11434`).
- **Local-Only Storage**: All conversation transcripts, vector embeddings, and configurations are stored in local SQLite databases within the user's application data directory.
- **Path Traversal Protection**: All filesystem operations are validated through `path_guard.rs` to prevent directory traversal exploits.
- **Log Sanitization & Error Redaction**: Structured trace logs and backend error payloads are sanitized to strip system paths, ANSI codes, and control characters before output.

---

## Contributing

We welcome contributions to Musaed! Please review [CONTRIBUTING.md](CONTRIBUTING.md) and [STANDARDS.md](STANDARDS.md) before submitting changes.

### Pre-PR Checklist

Before opening a pull request, ensure all local validation gates pass:

```bash
pnpm gate
```

Any architectural boundary violations, missing translation keys, or contract drifts will be caught automatically.

---

## License

This project is licensed under the terms of the [Apache License 2.0](LICENSE).
