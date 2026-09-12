# Contributing to Musaed

Musaed is a fully offline, privacy-first desktop AI assistant powered by
Ollama. It is a Tauri v2 app: a Rust backend (`src-tauri/`) and a Next.js
frontend (`apps/web/`), with shared IPC contracts in `packages/contracts/`.

## Prerequisites

- Node.js >= 22
- pnpm >= 11 (see `package.json` `engines`)
- Rust stable (see `rust-toolchain.toml`)
- Tauri v2 system dependencies (WebKitGTK on Linux, etc.)

## Setup

```bash
pnpm install
pnpm dev
```

## Before you open a PR

Run the full local gate — this is the same set of checks CI enforces:

```bash
pnpm gate
```

The gate runs lint, type-check, architecture boundaries, i18n, validation
constants, IPC contract + ACL validation, frontend tests, and Rust
format/clippy/test.

## Architecture

- `packages/contracts/` — the single source of truth for IPC command
  signatures and shared Zod schemas. Re-export from `index.ts`; never import
  sub-paths (see `STANDARDS.md` §7.2).
- `src-tauri/` — Tauri commands are thin adapters; business logic lives in
  domain modules (see `STANDARDS.md` §8.1).
- `apps/web/` — feature-first layout; no feature may import a sibling feature
  (see `STANDARDS.md` §5).

Read `STANDARDS.md` for the full set of conventions and machine-gated rules.
