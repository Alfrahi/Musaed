# 🚀 Musaed Engineering Standards

## **Production-Grade Offline Desktop AI System Spec**

---

# **0. SYSTEM IDENTITY**

> Musaed is a fully offline, native desktop AI assistant.

### Stack

- Next.js 16 (App Router, static export only)
- Tauri 2 (Rust backend)
- Zustand (UI state only)
- Domain-Driven Design (DDD)
- Fully offline execution (no external APIs or network calls)

---# **1. HARD SYSTEM CONSTRAINTS (NON-NEGOTIABLE)**

The system MUST NEVER:

- ❌ Use SSR or server rendering
- ❌ Make external network calls
- ❌ Access filesystem directly from frontend
- ❌ Bypass IPC layer
- ❌ Import across features directly
- ❌ Break offline execution model

---

# **2. REPOSITORY ARCHITECTURE BOUNDARIES**

## Frontend

```txt id="front"
apps/web/src/
```

## Backend

```txt id="back"
src-tauri/src/
```

## Shared Contracts (SOURCE OF TRUTH)

```txt id="contracts"
packages/contracts/
```

---

# **3. FEATURE ARCHITECTURE (STRICT DDD MODEL)**

## Feature Location

```txt id="features"
apps/web/src/features/[feature]/
```

## Required Structure

Each feature MUST include:

- `components/`
- `hooks/`
- `utils/` (optional)
- `index.ts` (PUBLIC API ONLY)
- `feature.manifest.ts` (REQUIRED)

---

## FEATURE OWNERSHIP RULE

Each feature owns:

- UI logic
- feature state orchestration
- feature-specific IPC calls
- feature-specific utilities

---

## FEATURE IMPORT RULES

### Allowed

- feature → shared/lib
- feature → sibling feature ONLY when that sibling is listed in the source
  feature's `feature.manifest.ts` `dependencies: [...]` array (see §4). This
  is a machine-validated contract — dep-cruiser reads the generated
  `apps/web/src/generated-feature-deps.json` (see `scripts/codegen-feature-deps.mjs`)
  and fails the build if any undeclared cross-feature import is found.
- non-feature → feature via `index.ts` ONLY
- `src/hooks/` may import from any feature barrel — it is the shared
  orchestration layer (e.g. `useAppInitialization` coordinates settings +
  library + conversation at startup). Boot-anywhere orchestrators that cross
  feature boundaries by design belong here, NOT inside `features/{x}/`.

### Forbidden

- feature → feature imports that are not declared in the source feature's
  manifest `dependencies:` (CI failure via `codegen:feature-deps:check` +
  dep-cruiser).
- deep imports into feature internals (only barrel `index.ts` is public)
- store cross-feature access via feature barrels — use `@/store/*` instead.
  The store layer lives in `src/store/` precisely because every feature
  depends on it; routing store getters through a feature barrel defeats the
  purpose of the feature boundary.

### Composition root exemption

`features/layout/` is the **single** feature exempt from the cross-feature
import rule. Its `HomeClient.tsx` mounts every other feature by design. No
`no-layout-to-other-features` dep-cruiser rule exists. Adding a new
feature with the same exemption is a Tier 3 architectural change (see §20)
and requires updating this section plus `.dependency-cruiser.js`.

The exemption is declared in `.dependency-cruiser.js` via the
`EXEMPT_FEATURES` array.

### Shared UI component guard

Components in `@/components/ui/` SHOULD be feature-agnostic design
primitives (buttons, modals, skeletons, badges). If a component needs
feature-specific behavior, it SHOULD live in the feature that owns it.
A dep-cruiser rule with severity `warn` flags `components/ui/` → feature
imports for review.

### Store composition

Hooks may read from multiple stores via Zustand selectors. This is the
intended pattern for cross-domain state access. Store-to-store imports
are restricted to the exceptions listed in §9. Cross-store coordination
that requires writing to multiple stores belongs in
`src/store/coordination.ts`.

---

# **4. FEATURE CONTRACT SYSTEM (NEW CORE MODEL)**

Each feature MUST define:

```txt id="manifest"
feature.manifest.ts
```

Contains:

- public API surface (`publicApi.hooks`, `publicApi.components`)
- IPC endpoints used (`ipcEndpoints`)
- state schema version (`stateSchemas`)
- persistence schema version (`persistenceSchemas`)
- dependency list (`dependencies`)
- failure modes (`failureModes`) — optional, but CI warns when absent

---

# **5. IPC SYSTEM (STRICT CONTRACT ARCHITECTURE)**

## Single IPC Entry Point

```txt id="ipc"
apps/web/src/lib/ipc.ts
```

---

## RULES

- ❌ No `window.__TAURI__.invoke()` anywhere
- ❌ No `@tauri-apps/*` outside IPC layer
- ✔ All IPC must go through `ipc.ts`

---

## IPC FLOW

```txt id="flow"
UI → ipc.ts → contracts → Rust commands → domain modules
```

---

## CONTRACT SOURCE OF TRUTH

```txt id="contractsrc"
packages/contracts
```

Must define:

- request/response types
- enums
- IPC command registry

---

## PUBLIC RE-EXPORT RULE

Any module added under `packages/contracts/src/` that is intended for
cross-package consumption MUST be re-exported from
`packages/contracts/src/index.ts`. A vitest alias or tsconfig path mapping is
NOT an acceptable substitute — sub-path imports such as
`@musaed/contracts/migrations` rely on consumer-side path-resolution and may
silently break under any tooling change (clean `tsc`, esbuild outside
`tsconfig`, Yarn 4, swc, etc.). When a new public module is added, add an
`export * from './<module>';` line to `index.ts` in the same commit that
introduces the module. CI greps for sub-path imports across `apps/` and
`src-tauri/` and fails the build when any are found.

---

## IPC DRIFT DETECTION

Breaking-change detection between the Rust `#[tauri::command]` signatures and
the TypeScript `CommandMap` is enforced at CI time by
`pnpm validate:contracts --strict` (`scripts/validate-contracts.mjs`), which
cross-checks argument count, names, types, and return types. There is no
runtime `_v1`/`_v2` command-name versioning scheme; any contract drift
between the Rust and TypeScript surfaces fails the build.

The `COMMAND_VERSIONS` map in `packages/contracts/src/command-versions.ts` is
a command registry (not a version map) — the frontend IPC bridge consults it
in development to warn about unregistered commands, and `latency.test.ts`
enumerates its keys to confirm every command has a latency budget.

---

## IPC ENDPOINT OWNERSHIP

Each IPC endpoint MUST have a single owning feature declared in its
manifest's `ipcEndpoints` array. Other features that need the endpoint
MUST declare the owning feature as a dependency and consume it through
that feature's public API, not by calling the IPC directly.

---

# **6. RUST ARCHITECTURE RULES**

## Domain Structure

```txt id="rustdom"
src-tauri/src/{domain}/
```

Domains:

- `ollama/` — Ollama engine: chat, streaming, model management, health
- `rag/` — retrieval-augmented generation: indexing, search, embeddings, context
- `trace_domain/` — structured logging & trace lifecycle (semantic match for the
  logging concern referenced elsewhere in this document as `logging/`)
- `conversation/` — conversation state, message persistence, export (markdown)
- `migrations/` — SQLite schema migrations and rollback

### Flat modules (not directories)

- `validation.rs` — stateless input-validation helpers. Kept as a flat root
  file rather than a domain directory because it carries no service/state;
  it is imported by other domains as a shared utility.

---

## RULES

- Commands MUST be thin adapters only
- Business logic MUST live inside domain modules
- No cross-domain internal coupling unless via shared layer
- All inputs MUST be validated
- All outputs MUST be structured types

---

## COMMAND RULE

```txt id="cmd"
cmd_* functions MUST NOT contain business logic
```

---

## SERVICE PATTERN

Domain services SHOULD use `Arc<RwLock<Store>>` for read-heavy stores
(e.g. `RagStore` with its connection pool) and `Arc<Mutex<Store>>` for
write-heavy stores (e.g. `ConversationStore`). New services MUST follow
the canonical pattern established by `OllamaChatService`:

- A struct with `Arc`-wrapped dependencies.
- A `new()` constructor that accepts dependencies explicitly.
- Public methods that take typed request structs and return
  `ApiResponse<T>` or `Result<ApiResponse<T>, BackendError>`.
- No direct Tauri state (`State<>`, `AppHandle`, `Window`) inside the
  service — those stay in the command adapter layer.

---

# **7. OLLAMA SYSTEM (LOCAL AI ENGINE)**

- Fully offline only

- Streaming must support:
  - cancellation
  - backpressure
  - incremental updates

- Model switching MUST:
  - abort active streams safely
  - reset runtime state cleanly

---

# **8. RAG SYSTEM RULES**

## Components

- indexing.rs
- search.rs
- bm25.rs
- embedder.rs

---

## RULES

- Indexing MUST be async + cancellable
- Search MUST support hybrid ranking (BM25 + vector)
- Results MUST be deterministic
- Context assembly MUST respect token budgets

---

# **9. STATE MANAGEMENT MODEL**

## Layers

| Layer            | Purpose               |
| ---------------- | --------------------- |
| UI state         | ephemeral UI only     |
| Domain state     | feature logic         |
| Persistent state | cross-session storage |

---

## RULES

- Zustand stores MUST be domain-separated
- No direct store mutation outside actions layer
- Cross-store imports are permitted only for:
  - **Hydration coordination**: Persisted stores may call
    `useUIStore.getState().onStoreRehydrated()` in their
    `onRehydrateStorage` callback.
  - **Stream orchestration**: `store/coordination.ts` may import all
    stores using `.getState()` exclusively for stream lifecycle
    management.
- No other cross-store imports are permitted. No store may subscribe to
  another store's state via hooks.

---

## Persistence

- Uses `tauri-plugin-store`
- MUST include schema version
- ALL schema changes require migration logic

---

# **10. IPC + RUST CONTRACT ALIGNMENT**

Every IPC call MUST map to:

- Rust command
- Contract definition
- Versioned schema

Mismatch between any layer = CI failure

---

# **11. INTERNATIONALIZATION (i18n)**

- ❌ No hardcoded strings
- ✔ All strings in:

```txt id="i18n"
apps/web/locales/{lang}.json
```

- RTL handled via `DirectionProvider`
- CI MUST validate missing keys

---

# **12. RTL RULES**

- Must fully support LTR + RTL
- `.mirror-rtl` required for icons
- Tajawal font for Arabic
- Direction MUST derive from i18n only

---

# **13. ERROR HANDLING MODEL**

## Frontend

- Must use ErrorBoundary
- Must show translated errors only
- No raw backend errors exposed

## Backend

- Structured error enums only
- No panic propagation to UI
- Logging only internally

---

## FAILURE MODE RULE

Each feature SHOULD document its failure modes in its
`feature.manifest.ts`:

```typescript
failureModes?: Record<string, {
  fallback: string;      // Description of fallback behavior
  retry: 'none' | 'once' | 'exponential';
  messageKey: string;    // i18n key for user-visible message
}>;
```

CI warns (does not fail) when a feature with IPC endpoints has no
`failureModes` defined.

---

# **14. OBSERVABILITY MODEL (TRACE-BASED)**

All logs MUST be structured:

```json id="log"
{
  traceId,
  feature,
  action,
  latencyMs,
  status,
  source
}
```

---

## Observability Coverage

- IPC calls
- Rust commands
- RAG indexing/search
- Ollama streaming lifecycle
- store mutations

CI MUST verify trace coverage:

- Every Rust domain module MUST contain at least one `tracing::` call
  (grep-enforced: `grep -L 'tracing::' src-tauri/src/{domain}/*.rs` fails
  the build when a domain module has zero trace instrumentation).
- Every frontend store MUST contain at least one `traceStoreMutation` or
  `traceApi` call (grep-enforced per store file).
- Every IPC method in `CommandMap` MUST emit a trace span via
  `dispatchIpcViolationTrace` or `recordIpcLatency` (grep-enforced:
  `grep -c 'dispatchIpcViolationTrace\|recordIpcLatency'` must equal the
  number of entries in `CommandMap`).

---

# **15. PERFORMANCE RULES**

## Required

- virtualized chat rendering
- memoized message components
- streaming UI updates (no full rerenders)
- paginated or streamed RAG results

---

## OPTIONAL BUT ENFORCEABLE (CI LEVEL)

- IPC latency budgets per feature
- render time budgets
- memory usage constraints

---

# **16. SECURITY MODEL**

- Fully offline system (zero network access)
- Filesystem access ONLY via Rust
- Frontend has no file system visibility
- IPC input validation REQUIRED

---

# **17. TESTING REQUIREMENTS**

## Frontend

- IPC mock tests
- store logic tests
- feature-level hooks tests
- All test files must use the `.test.ts` (or `.test.tsx`) naming convention and be placed in the same directory as the source file.

## Backend

- Ollama streaming tests
- RAG correctness tests
- command validation tests

---

# **18. CI ENFORCEMENT (MACHINE-GATED)**

CI MUST FAIL IF:

- cross-feature imports exist that are NOT declared in the source feature's
  `feature.manifest.ts` `dependencies: []` array (see §3 Feature IMPORT rules).
  This is enforced by `pnpm codegen:feature-deps:check` followed by
  `pnpm arch-check` — the codegen step asserts the generated
  `apps/web/src/generated-feature-deps.json` is in sync with the manifests,
  and dep-cruiser consumes that JSON to decide which cross-feature edges are
  legal.
- IPC bypass is detected
- contract mismatch exists
- schema version mismatch exists
- i18n keys missing
- architecture graph violations exist

---

## TOOL ENFORCEMENT MAP

| Rule                    | Tool                                       |
| ----------------------- | ------------------------------------------ |
| Dependency rules        | dependency-cruiser                         |
| Type safety             | TypeScript                                 |
| Rust correctness        | cargo clippy                               |
| Lint rules              | ESLint                                     |
| staged hygiene          | Husky                                      |
| architecture graph      | dependency-cruiser                         |
| contracts validation    | custom CI script                           |
| manifest `dependencies` | `codegen:feature-deps:check` + dep-cruiser |

---

# **19. ARCHITECTURE DRIFT PREVENTION**

CI MUST validate:

- feature dependency graph — and the graph MUST match each feature's
  `feature.manifest.ts` `dependencies:` array. The codegen script
  `scripts/codegen-feature-deps.mjs` reads every manifest, emits
  `apps/web/src/generated-feature-deps.json`, and dep-cruiser consumes that
  JSON so the manifest is a real contract, not documentation.
- IPC ↔ Rust ↔ contracts alignment
- store isolation — stores live in `src/store/`; no `features/{x}/store/`
  re-exports should reach a sibling feature.
- feature manifest consistency — `publicApi.hooks` and `publicApi.components`
  must mirror what `index.ts` re-exports; `stateSchemas` versions must match
  the `version:` written by the store, and `dependencies:` must list every
  sibling feature that this feature actually imports.

---

# **20. CHANGE MANAGEMENT MODEL**

## Tier 1 — Safe

- UI changes
- internal feature refactors

## Tier 2 — Controlled

- IPC changes
- store schema changes

## Tier 3 — Architectural

- feature boundary changes
- domain restructuring
- IPC command signature changes

---

# **21. AI CODE MODIFICATION RULES**

When modifying code:

- Only touch relevant files
- Do NOT invent dependencies
- Do NOT create new architecture unless requested
- Always provide:
  - intent summary
  - affected modules
  - diff
  - risk analysis
  - rollback plan

---

# **22. CORE ARCHITECTURAL MODEL**

> Musaed is a closed-loop offline intelligence system.

### System layers:

- Frontend → UI shell
- IPC → controlled system interface
- Rust → system truth layer
- Stores → memory layer
- RAG → knowledge layer
- Ollama → reasoning engine

---

# **FINAL RULE**

> If a change cannot be validated by CI, it is not production-safe.
