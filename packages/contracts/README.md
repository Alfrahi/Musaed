# @musaed/contracts

Shared TypeScript contracts — the single source of truth for types, schemas, and constants shared between the Next.js frontend and the Tauri Rust backend.

## Responsibilities

- Define **IPC command names** and the command registry (`command-versions.ts`)
- Define **feature manifest types** that every `feature.manifest.ts` is typed against (`manifest.ts`)
- Define **Zod schemas** and **TypeScript types** for chat, conversation, RAG, Ollama, UI, and validation
- Define **migration version constants** for the SQLite schema migration system (`migrations.ts`)
- Define **IPC latency budgets** per command (`latency.ts`)
- Define **structured error types** (`errors.ts`)
- Provide shared **utility functions** (sanitize, thinking-tags, async, worker utils)

## Architecture

```
packages/contracts/
├── package.json         # name: @musaed/contracts, main: ./src/index.ts
├── tsconfig.json        # extends root tsconfig, rootDir: ./src
├── typedoc.json         # API docs config
└── src/
    ├── index.ts          # PUBLIC BARREL — re-exports everything below
    ├── index.test.ts     # Smoke tests for the barrel
    ├── command-versions.ts  # COMMAND_VERSIONS registry + SHARED_COMMANDS + CommandName type
    ├── manifest.ts        # FeatureManifest interface (typed contract for feature.manifest.ts)
    ├── migrations.ts     # Migration version constants (conversations v3, rag v3)
    ├── latency.ts        # IPC_LATENCY_BUDGETS per command
    ├── errors.ts         # BackendError type + error code constants
    ├── constants.ts      # App-wide constants
    ├── redactedThinking.ts # Redacted thinking block handling
    ├── validation-limits.ts # Input validation limits
    ├── generated/
    │   └── specta-types.ts  # Generated from Rust specta (currently not re-exported)
    ├── types/
    │   ├── ollama.ts      # Ollama model, health, chat types
    │   ├── chat.ts        # Chat message, streaming types
    │   ├── conversation.ts # Conversation metadata, message types
    │   ├── rag.ts         # RAG project, chunk, search result types
    │   ├── ui.ts          # UI state types
    │   └── web-worker.d.ts # Web worker type declarations
    ├── schemas/           # Zod schemas (runtime validators)
    │   ├── ollama.ts
    │   ├── chat.ts
    │   ├── conversation.ts
    │   ├── rag.ts
    │   ├── validation.ts
    │   ├── context-menu.ts
    │   ├── tray.ts
    │   └── menu-bar.ts
    └── utils/
        ├── sanitize.ts
        ├── thinking-tags.ts
        ├── workerUtils.ts
        └── async.ts
```

## Public API

Everything is re-exported from `src/index.ts`. Import from the barrel only:

```ts
import { type FeatureManifest, COMMAND_VERSIONS, type ChatMessage } from '@musaed/contracts';
```

### Public re-export rule

Any module added under `packages/contracts/src/` that is consumed cross-package **must** be re-exported from `src/index.ts` in the same commit. Sub-path imports like `@musaed/contracts/migrations` are forbidden — they rely on consumer-side path resolution and may break under tooling changes. CI greps for sub-path imports across `apps/` and `src-tauri/` and fails the build when found (see `STANDARDS.md §5 PUBLIC RE-EXPORT RULE`).

## Key exports

| Export                | Module                | Purpose                                                       |
| --------------------- | --------------------- | ------------------------------------------------------------- |
| `COMMAND_VERSIONS`    | `command-versions.ts` | Registry of every IPC command name (source of truth)          |
| `SHARED_COMMANDS`     | `command-versions.ts` | Commands callable by any feature without manifest declaration |
| `CommandName`         | `command-versions.ts` | Union type of all command names                               |
| `FeatureManifest`     | `manifest.ts`         | Interface for feature.manifest.ts files                       |
| `FeaturePublicApi`    | `manifest.ts`         | Interface for the publicApi section of manifests              |
| `BackendError`        | `errors.ts`           | Structured error type returned by Rust commands               |
| `ApiResponse<T>`      | `index.ts`            | Wrapper for IPC responses (`{ success, data, error }`)        |
| `IPC_LATENCY_BUDGETS` | `latency.ts`          | Per-command latency thresholds in ms                          |
| Zod schemas           | `schemas/*.ts`        | Runtime validators for IPC payloads                           |
| TypeScript types      | `types/*.ts`          | Domain types (ollama, chat, conversation, rag, ui)            |

## Development

```bash
# Type-check
pnpm --filter @musaed/contracts type-check

# Lint
pnpm --filter @musaed/contracts lint

# Generate API docs (TypeDoc)
pnpm --filter @musaed/contracts docs
```

## IPC contract validation

Breaking-change detection between Rust `#[tauri::command]` signatures and the TypeScript `CommandMap` is enforced at CI time by:

```bash
pnpm validate:contracts --strict
```

This cross-checks argument count, names, types, and return types. There is no runtime versioning scheme — any contract drift between Rust and TypeScript fails the build (see `STANDARDS.md §5 IPC DRIFT DETECTION`).

## Related documentation

- [Root README](../../README.md)
- [STANDARDS.md §5 — IPC System](../../STANDARDS.md)
- [Tauri IPC Enforcement](../../docs/tauri-ipc-enforcement.md)
