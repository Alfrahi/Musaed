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

---

# **1. HARD SYSTEM CONSTRAINTS (NON-NEGOTIABLE)**

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
- optional `feature.manifest.ts` (REQUIRED FOR COMPLEX FEATURES)

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

---

# **4. FEATURE CONTRACT SYSTEM (NEW CORE MODEL)**

Each feature SHOULD define:

```txt id="manifest"
feature.manifest.ts
```

Contains:

- public API surface
- IPC endpoints used
- state schema version
- persistence schema version
- dependency list

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
- IPC version contracts

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

## IPC VERSIONING RULE

- Breaking change → MUST create new version
- Example:

```txt id="ipcver"
chat.sendMessage_v1
chat.sendMessage_v2
```

- Old versions MUST remain until migration is complete

---

# **6. RUST ARCHITECTURE RULES**

## Domain Structure

```txt id="rustdom"
src-tauri/src/{domain}/
```

Domains:

- `ollama/`
- `rag/`
- `logging/`
- `validation/`

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
- No cross-store imports
- No direct store mutation outside actions layer

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

## FAILURE MODE RULE (NEW)

Every feature MUST define:

- fallback behavior
- retry policy
- user-visible message (i18n)

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
- IPC version changes

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
