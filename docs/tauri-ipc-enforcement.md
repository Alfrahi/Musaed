# Tauri IPC Access Enforcement

This document describes how Musaed enforces the IPC layer as the sole entry point to Tauri functionality.

## Rule

**All access to Tauri APIs must go through the IPC bridge layer:**

- ✅ `apps/web/src/lib/ipc.ts`
- ✅ `apps/web/src/lib/tauri-storage.ts`

Direct access to `window.__TAURI__`, `window.__TAURI_INTERNALS__`, or imports from `@tauri-apps/*` packages is **forbidden** everywhere else.

## Enforcement Layers

### ESLint (`eslint.config.mjs`)

The `no-restricted-syntax` rule blocks:

1. **Global Tauri objects:**
   - `window.__TAURI__`
   - `window.__TAURI_INTERNALS__`

2. **Direct Tauri API imports:**
   - `@tauri-apps/api/*` (including `@tauri-apps/api/core`)
   - `@tauri-apps/plugin-*`

3. **Direct `invoke()` calls:**
   - Any bare `invoke()` call not going through the IPC bridge

**Allowed exceptions** (rules disabled):

- `apps/web/src/lib/ipc.ts`
- `apps/web/src/lib/tauri-storage.ts`
- `apps/web/src/__mocks__/`
- `apps/web/src/tests/`
- `*.test.ts`, `*.test.tsx`

### Dependency Cruiser (`.dependency-cruiser.js`)

Architecture-level rules block:

1. Any import from `^@tauri-apps/api` (except allowed files)
2. Any import from `^@tauri-apps/plugin-` (except allowed files)

These rules enforce feature isolation and prevent coupling to the Tauri runtime outside the IPC layer.

## Why This Matters

| Concern       | Benefit                                          |
| ------------- | ------------------------------------------------ |
| **Security**  | Filesystem access controlled via Rust only       |
| **Offline**   | No external network calls possible from frontend |
| **Testing**   | IPC layer can be mocked for unit tests           |
| **Migration** | Single point to update if Tauri APIs change      |
| **Contract**  | Clear boundary between frontend and Rust backend |

## Validation

Run these commands to verify compliance:

```bash
# ESLint validation
pnpm lint

# Architecture boundary validation
pnpm arch-check

# Full validation suite
pnpm validate
```

## Adding New IPC Commands

When extending Tauri functionality:

1. Add the Rust command in `src-tauri/src/`
2. Export it via `src-tauri/src/lib.rs`
3. Define the contract in `packages/contracts/`
4. Add the frontend wrapper in `apps/web/src/lib/ipc.ts`
5. **Do not** import Tauri APIs directly in features or components
