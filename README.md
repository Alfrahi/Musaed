# Musaed

A fully offline, native desktop AI assistant built on Ollama. Supports local RAG (Retrieval-Augmented Generation), RTL languages, and privacy-first operation with zero external network calls.

## Architecture

Musaed is a Tauri 2 monorepo with three main components:

```
├── apps/web/          # Next.js 16 (App Router, static export) — frontend + UI
├── packages/contracts/ # Shared TypeScript contracts — the source of truth for IPC types
├── src-tauri/         # Rust backend — Ollama, RAG, conversation persistence, migrations
├── docs/              # Architecture docs (migration framework, IPC enforcement, logging)
├── scripts/           # CI validation & codegen scripts
└── STANDARDS.md       # Engineering standards (authoritative spec)
```

### System layers

- **Frontend** → UI shell (Next.js, React 19, Zustand, Tailwind v4)
- **IPC** → controlled system interface (`apps/web/src/lib/ipc.ts`)
- **Contracts** → shared types and schemas (`packages/contracts`)
- **Rust** → system truth layer (Ollama, RAG, SQLite persistence)
- **Stores** → memory layer (8 Zustand stores in `apps/web/src/store/`)

### Feature architecture (DDD)

The frontend is organized into 8 feature modules under `apps/web/src/features/`, each with a strict public API (`index.ts`) and a machine-validated manifest (`feature.manifest.ts`):

| Feature        | Responsibility                                            |
| -------------- | --------------------------------------------------------- |
| `conversation` | Chat with Ollama — streaming, persistence, attachments    |
| `sidebar`      | Conversation list, grouping, export to Markdown           |
| `library`      | Ollama model management — install, browse, select         |
| `rag`          | RAG — projects, indexing, hybrid search, context assembly |
| `settings`     | App configuration — Ollama, theme, language, storage      |
| `search`       | Full-text message search across conversations             |
| `info`         | About modal — version, links                              |
| `layout`       | Composition root — mounts all features                    |

Cross-feature imports are enforced by dependency-cruiser, driven by each feature's manifest `dependencies` array. `layout` is the sole exempt feature (composition root).

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- **Rust** stable toolchain (rustfmt, clippy)
- **System libs** (Linux): `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libssl-dev`

## Development

```bash
# Install dependencies
pnpm install

# Start Tauri dev (launches Next.js dev server + Rust backend)
pnpm dev

# Run Next.js dev server only (without Tauri backend)
pnpm --filter web dev
```

## Common commands

| Command                                                                                         | Purpose                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                                                                      | Tauri dev mode (frontend + backend)                   |
| `pnpm build`                                                                                    | Tauri production build                                |
| `pnpm prod:build`                                                                               | Full production build with validation + i18n check    |
| `pnpm test`                                                                                     | Frontend unit tests (Vitest)                          |
| `pnpm --filter web test:integration`                                                            | Frontend integration tests (Vitest)                   |
| `pnpm lint`                                                                                     | ESLint on `apps/web/src`                              |
| `pnpm type-check`                                                                               | TypeScript check across all workspace projects        |
| `pnpm arch-check`                                                                               | dependency-cruiser boundary check                     |
| `pnpm validate`                                                                                 | Full validation: lint + type-check + i18n + manifests |
| `pnpm validate:contracts --strict`                                                              | Rust ↔ TypeScript IPC contract alignment              |
| `pnpm validate:manifests`                                                                       | Feature manifest consistency check                    |
| `pnpm codegen:feature-deps`                                                                     | Generate `generated-feature-deps.json` from manifests |
| `pnpm codegen:validation`                                                                       | Generate validation constants                         |
| `pnpm i18n:sync`                                                                                | Sync i18n locale keys                                 |
| `pnpm i18n:check`                                                                               | Validate i18n key completeness                        |
| `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`                               | Rust format check                                     |
| `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` | Rust lints                                            |
| `cargo test --manifest-path src-tauri/Cargo.toml`                                               | Rust tests                                            |

## CI

CI is defined in `.github/workflows/ci.yml` with 5 jobs:

1. **Validate** — lint, type-check, architecture check, i18n, contract validation, no-TODO check
2. **Test** — frontend unit tests
3. **Rust** — fmt, clippy (-D warnings), cargo test
4. **Visual Tests** — Playwright RTL (non-blocking)
5. **Build** — static export verification

All checks are machine-gated. See `STANDARDS.md §18` for the full enforcement map.

## i18n

Translations live in `apps/web/locales/{en,ar}.json`. The i18n system is in `apps/web/src/lib/i18n.ts`. CI validates key completeness via `pnpm i18n:check`.

## Key documentation

- [`STANDARDS.md`](./STANDARDS.md) — Authoritative engineering standards (read this first)
- [`docs/migration-framework.md`](./docs/migration-framework.md) — SQLite schema migration system
- [`docs/tauri-ipc-enforcement.md`](./docs/tauri-ipc-enforcement.md) — IPC contract validation
- [`docs/structured-logging.md`](./docs/structured-logging.md) — Trace-based observability
- [`packages/contracts/README.md`](./packages/contracts/README.md) — Shared contracts package
- [`src-tauri/README.md`](./src-tauri/README.md) — Rust backend
- Feature READMEs — one per feature in `apps/web/src/features/*/README.md`

## License

MIT
