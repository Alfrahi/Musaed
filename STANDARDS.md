# Musaed Engineering Standards

> **Purpose:** protect the architectural, security, privacy, and reliability properties of Musaed.
>
> **Core principle:** **be strict about boundaries, flexible about implementations.**

---

## 0. Engineering Principles

Musaed is a fully offline, native desktop AI assistant. The standards exist to keep the system understandable and safe as it grows, not to turn every coding preference into a rule.

Contributors should prefer:

1. The simplest solution that satisfies the architecture.
2. Existing project patterns over new abstractions.
3. Small, local changes over broad refactors.
4. Automated validation over rules that depend entirely on reviewer memory.
5. Explicit decisions over accidental architecture.

### 0.1 Normative language

The words below are intentional:

- **MUST** — required. Breaking the rule changes a protected architectural, security, privacy, compatibility, or correctness property.
- **MUST NOT** — prohibited.
- **SHOULD** — preferred default. A contributor may deviate when there is a good technical reason.
- **SHOULD NOT** — discouraged default, but not forbidden.
- **MAY** — optional.

A SHOULD deviation should be explained briefly in the pull request when it is not obvious.

A MUST/MUST NOT deviation is an architectural decision and requires explicit review.

---

# 1. System Identity

## 1.1 Stack

Musaed currently uses:

- Next.js 16 with App Router and static export only
- Tauri 2
- Rust backend
- TypeScript frontend
- Zustand for UI/application state where appropriate
- Domain-oriented architecture
- Local AI execution through approved local services such as Ollama
- Local persistence and local filesystem access

Technology versions are implementation details and MAY evolve. The architectural boundaries in this document are more important than any single library version.

## 1.2 Offline definition

"Offline" means that normal application operation does not require communication with external network services.

Musaed MUST NOT:

- call external cloud AI APIs;
- send telemetry or analytics to third parties;
- fetch remote UI assets at runtime;
- depend on CDNs at runtime;
- silently fall back to online services;
- perform background network checks that are not explicitly approved.

Local loopback communication with explicitly approved local components, such as Ollama, is allowed when required by the architecture.

Any new network-capable component MUST be reviewed as a security and offline-boundary change.

---

# 2. Non-Negotiable Architectural Boundaries

The following are protected system boundaries.

## 2.1 Frontend/system boundary

Frontend code MUST NOT access the operating system directly for privileged resources such as arbitrary filesystem operations, native commands, or other protected system APIs.

The normal path is:

```text
Frontend
  -> IPC bridge
  -> typed contract
  -> Tauri command
  -> application/domain service
  -> infrastructure
```

## 2.2 IPC boundary

All Tauri IPC calls from the frontend MUST pass through the centralized IPC bridge.

The frontend MUST NOT call Tauri internals directly from feature code.

## 2.3 Feature boundary

Features MUST NOT reach into another feature's internal implementation.

Cross-feature usage MUST go through the consuming feature's declared dependency and the providing feature's public API.

The architecture MAY allow explicit composition-root exceptions where the application shell intentionally mounts multiple features.

## 2.4 Contract boundary

The TypeScript contract surface and Rust command surface MUST remain synchronized.

Drift that changes command names, arguments, types, return shapes, or semantics MUST be treated as a contract change.

---

# 3. Repository Architecture

The repository currently uses these major areas:

```text
apps/web/src/           Frontend application
src-tauri/src/          Tauri/Rust backend
packages/contracts/     Shared frontend/backend contracts
```

Additional top-level packages MAY be introduced when they have clear ownership and a documented reason.

Do not create a new package merely to move a small amount of code.

---

# 4. Frontend Architecture

## 4.1 Feature location

Feature code SHOULD live under:

```text
apps/web/src/features/<feature>/
```

## 4.2 Feature public API

Every feature MUST expose a deliberate public API through:

```text
index.ts
```

Internal modules MUST NOT be imported directly by unrelated code.

## 4.3 Feature manifest

Every meaningful feature MUST have:

```text
feature.manifest.ts
```

The manifest defines architectural metadata rather than implementation details.

At minimum, it SHOULD describe:

- public API surface;
- IPC endpoints owned by the feature, when applicable;
- persistent state schema versions, when applicable;
- feature dependencies.

Failure modes MAY be documented there and SHOULD be documented for features with meaningful IPC or persistence failure paths.

## 4.4 Feature directory shape

The following is a recommended structure, not a mandatory template:

```text
feature/
├── components/       # when the feature has reusable feature UI
├── hooks/            # when feature hooks are needed
├── utils/            # when feature-specific helpers are needed
├── feature.manifest.ts
└── index.ts
```

Do not create empty directories just to satisfy a template.

## 4.5 Feature ownership

A feature should own its:

- feature-specific UI;
- feature-specific orchestration;
- feature-specific validation/helpers;
- feature-specific IPC usage;
- feature-specific tests.

Shared infrastructure belongs in an appropriate shared layer rather than in an arbitrary feature.

---

# 5. Feature Dependency Rules

## 5.1 Allowed dependencies

A feature MAY depend on:

- shared libraries;
- shared contracts;
- approved global state/infrastructure;
- another feature when that dependency is explicitly declared in the source feature manifest.

Non-feature code MAY consume feature functionality through the feature barrel.

## 5.2 Forbidden dependencies

The following are prohibited:

- undeclared feature-to-feature dependencies;
- imports into another feature's internal files;
- feature code depending on generated dependency metadata directly;
- using a feature barrel as an alternate path into global infrastructure that belongs in `src/store`, shared libraries, or another proper layer.

## 5.3 Composition root

The application composition root MAY coordinate multiple features.

The current layout/home composition feature is the primary example.

Additional composition-root exceptions SHOULD be rare and MUST be documented in the architecture configuration when added.

---

# 6. Shared UI Components

Components under a shared UI namespace SHOULD be implementation-agnostic design primitives:

- buttons;
- inputs;
- dialogs;
- badges;
- skeletons;
- layout primitives;
- other reusable visual controls.

A component with meaningful feature behavior SHOULD live in the feature that owns that behavior.

Shared UI code MUST NOT quietly become a second feature layer.

---

# 7. IPC and Contracts

## 7.1 Single IPC bridge

The frontend MUST use the project's centralized IPC bridge, currently:

```text
apps/web/src/lib/ipc.ts
```

Direct calls such as:

```text
window.__TAURI__.invoke(...)
```

or direct `@tauri-apps/*` usage from feature code are prohibited unless the integration itself belongs inside the approved IPC abstraction.

## 7.2 Contract source of truth

Shared request/response types, enums, and command definitions SHOULD be centralized under:

```text
packages/contracts/
```

Public modules intended for package consumers MUST be re-exported from the package entry point.

Consumers SHOULD NOT depend on undocumented sub-path imports.

## 7.3 Endpoint ownership

Each IPC endpoint MUST have one logical owning feature or subsystem.

Other features that need the endpoint SHOULD depend on that owner instead of creating duplicate IPC ownership.

## 7.4 Contract changes

An IPC change MUST include:

- updated shared types/registry;
- updated Rust command surface;
- updated tests;
- compatibility/migration handling when persisted or externally visible behavior changes.

Command names do not need artificial `_v1`/`_v2` suffixes unless there is an actual need to support multiple incompatible contracts simultaneously.

## 7.5 Validation

CI SHOULD verify:

- command registration;
- argument count and names;
- request/response types;
- registry consistency;
- command latency-budget coverage where latency budgets exist.

---

# 8. Rust Backend Architecture

## 8.1 Command adapters

Tauri commands MUST be thin adapters.

Commands SHOULD handle:

- extracting application state;
- authorization/permission checks where applicable;
- input decoding;
- calling an application/domain service;
- mapping the result into the IPC contract.

Commands SHOULD NOT contain business logic.

## 8.2 Application/domain/infrastructure separation

Where practical, backend code SHOULD follow:

```text
Tauri command
      |
      v
Application/use-case orchestration
      |
      v
Domain logic
      |
      v
Infrastructure (filesystem, database, Ollama, OS APIs)
```

Not every small operation needs all four layers. Avoid ceremony for its own sake.

## 8.3 Domain modules

Current domain areas include concepts such as:

- Ollama/local AI;
- RAG;
- tracing/observability;
- conversations;
- persistence/migrations.

The exact domain directory names MAY evolve as boundaries become clearer.

## 8.4 Services

Services SHOULD:

- accept explicit typed dependencies;
- expose typed request/response APIs;
- avoid direct dependency on Tauri `State`, `Window`, or `AppHandle` unless the service is specifically an adapter/integration layer;
- return structured errors.

Concurrency primitives such as `Mutex`, `RwLock`, channels, task ownership, or other mechanisms SHOULD be selected according to actual workload and correctness needs. The standards do not prescribe one synchronization primitive for every service.

## 8.5 Input validation

All external input crossing into the backend MUST be validated at an appropriate trust boundary.

Validation SHOULD be centralized when the same rule is used by multiple entry points.

---

# 9. Ollama and Local AI

## 9.1 Local execution

AI inference MUST remain local under the offline product model.

The application MUST clearly distinguish:

- local service unavailable;
- model unavailable;
- model loading;
- inference failure;
- user cancellation;
- timeout/backpressure conditions.

## 9.2 Streaming

Streaming implementations MUST account for:

- cancellation;
- backpressure;
- connection/task cleanup;
- incremental UI updates;
- partial-result handling;
- model-switch interruption.

A model switch MUST NOT leave an orphaned active stream or stale runtime state.

## 9.3 AI quality

Tests SHOULD cover deterministic infrastructure behavior and representative AI workflows, but the standards MUST NOT assume that model output itself is perfectly deterministic.

Where AI output quality matters, use explicit evaluation criteria rather than brittle exact-string assertions.

---

# 10. RAG System

RAG functionality SHOULD keep clear separation between:

- indexing;
- retrieval/search;
- ranking;
- embedding generation;
- context assembly.

Indexing SHOULD be asynchronous and cancellable.

Search SHOULD support hybrid ranking where both lexical and vector retrieval are useful.

Results used for application logic SHOULD be reproducible for the same indexed data, configuration, and query where deterministic ranking is expected.

Context assembly MUST respect explicit model/token budgets.

---

# 11. State Management

## 11.1 State layers

The application distinguishes:

| Layer                    | Purpose                              |
| ------------------------ | ------------------------------------ |
| UI state                 | Ephemeral presentation state         |
| Domain/application state | Current feature/application behavior |
| Persistent state         | Data that survives process restarts  |

Do not use persistent stores as an automatic replacement for proper domain modeling.

## 11.2 Zustand

Zustand stores SHOULD be domain-oriented and narrowly scoped.

A store MUST expose controlled actions rather than allowing arbitrary direct mutation throughout the application.

## 11.3 Cross-store coordination

Cross-store reads MAY be composed through selectors/hooks when that is the natural application pattern.

Cross-store writes SHOULD be centralized in an orchestration/coordination module when multiple domains must change together.

Avoid hidden store-to-store subscriptions and cycles.

A store may live under `src/store/` when shared by multiple features. A truly private store MAY remain inside a feature.

## 11.4 Persistence

Persisted state MUST include a schema version.

Every incompatible persistent schema change MUST include migration logic.

Destructive migrations MUST have an explicit recovery strategy.

---

# 12. Errors and Failure Modes

## 12.1 Frontend

The frontend SHOULD use error boundaries at appropriate application/feature boundaries.

User-facing errors MUST be understandable and translated.

Raw backend exceptions, stack traces, filesystem paths, SQL details, or internal implementation errors MUST NOT be exposed to users unless intentionally classified as safe diagnostics.

## 12.2 Backend

Backend failures SHOULD use structured error types/enums.

Panics MUST NOT be used as normal application error propagation.

Unexpected failures SHOULD be logged internally with enough context to diagnose them without exposing sensitive data.

## 12.3 Feature failure modes

Features with IPC, persistence, or long-running operations SHOULD document:

- expected failure modes;
- fallback behavior;
- retry policy;
- user-facing message key.

A failure-mode manifest entry is useful when these behaviors are important enough to coordinate or validate automatically.

---

# 13. Observability

All operational logs SHOULD be structured.

A useful event shape is:

```json
{
  "traceId": "...",
  "feature": "...",
  "action": "...",
  "latencyMs": 0,
  "status": "...",
  "source": "..."
}
```

## 13.1 What should be observable

The system SHOULD provide traceability for important boundaries, including:

- IPC calls;
- backend commands;
- long-running domain operations;
- RAG indexing/search;
- AI streaming lifecycle;
- important persistence transitions;
- significant state mutations;
- failures and cancellation.

Do not instrument every trivial helper merely to satisfy a numeric coverage target.

## 13.2 Sensitive data

Logs MUST NOT contain:

- secrets;
- tokens;
- passwords;
- private keys;
- unnecessary personal/user content;
- raw document contents unless explicitly approved for diagnostic purposes.

---

# 14. Security and Privacy

Security is a system property, not a final checklist.

## 14.1 Filesystem

Filesystem access MUST be performed through the backend/native boundary.

Path handling MUST account for traversal, invalid paths, unexpected symlinks, and platform-specific path behavior where relevant.

## 14.2 IPC input

Never trust frontend input merely because it came from the local UI. Backend validation remains required.

## 14.3 Secrets

Secrets, credentials, private certificates, tokens, and API keys MUST NOT be committed to the repository.

Development secrets MUST be supplied through approved local mechanisms.

## 14.4 Dependencies

New dependencies SHOULD be reviewed for:

- security history;
- maintenance health;
- license compatibility;
- offline/runtime network behavior;
- bundle/install cost;
- native platform compatibility;
- supply-chain risk.

## 14.5 Privacy

User data SHOULD remain local by default.

A new feature that moves user data outside the local machine is a security/privacy architecture change, not a routine implementation detail.

---

# 15. Internationalization and RTL

## 15.1 User-visible text

User-visible application strings MUST use the i18n system.

The standards do not require translation of:

- developer-only logs;
- test descriptions;
- protocol identifiers;
- technical identifiers;
- generated model/file values where translation is not appropriate.

## 15.2 Translation quality

CI SHOULD detect missing translation keys and invalid locale structure.

## 15.3 Directionality

UI direction MUST come from the application's locale/i18n state rather than ad-hoc feature conditions.

Both LTR and RTL layouts MUST be treated as first-class layouts.

Directional icons SHOULD use an approved mirroring mechanism such as `.mirror-rtl` when their meaning depends on direction.

## 15.4 Fonts

The application MUST use an Arabic-capable font stack for Arabic locales.

Tajawal is the current preferred font, but the standard deliberately allows the design system to change the approved font stack later.

---

# 16. Accessibility

User-facing UI SHOULD support:

- keyboard navigation;
- visible focus states;
- semantic controls;
- accessible names/labels;
- dialog/modal semantics;
- sensible reading order;
- reduced-motion preferences where animation is used;
- RTL-aware navigation and semantics.

Accessibility regressions SHOULD be considered part of UI correctness, not optional polish.

---

# 17. Performance

Performance requirements should reflect measured bottlenecks rather than arbitrary optimization rules.

The application SHOULD:

- virtualize very large chat/message lists;
- avoid unnecessary full-list rerenders during streaming;
- memoize expensive components when measurement shows value;
- paginate, stream, or incrementally render large RAG result sets;
- keep expensive work off the UI thread.

## 17.1 Budgets

Latency, rendering, and memory budgets MAY be defined for critical paths.

A budget MUST have:

- a measurable metric;
- a documented reason;
- a reasonable test environment;
- an agreed response when exceeded.

Do not add performance gates that produce flaky CI noise.

---

# 18. Testing

Testing should protect behavior and boundaries, not implementation details.

## 18.1 Frontend

The project SHOULD test:

- IPC bridge behavior;
- important store actions/selectors;
- feature hooks and business-critical UI logic;
- accessibility-sensitive flows;
- failure states.

## 18.2 Backend

The project SHOULD test:

- command validation;
- domain behavior;
- persistence/migrations;
- Ollama/local AI streaming lifecycle;
- RAG indexing/retrieval/ranking behavior;
- important filesystem/security behavior.

## 18.3 Integration tests

Integration tests SHOULD be used where correctness depends on multiple layers working together.

## 18.4 End-to-end tests

Critical user workflows MAY have end-to-end coverage, especially:

- application startup;
- model selection;
- conversation creation;
- streaming/cancellation;
- persistence across restart;
- document indexing and retrieval;
- RTL locale switching where applicable.

## 18.5 Test placement

Unit tests SHOULD normally sit near the source they cover.

Integration, end-to-end, fixtures, and shared test utilities MAY use dedicated test directories.

## 18.6 Avoid brittle tests

Tests SHOULD assert observable behavior rather than exact internal implementation.

AI output tests SHOULD prefer structural/semantic expectations over exact prose unless the behavior is intentionally deterministic.

---

# 19. CI and Automated Enforcement

CI exists to catch violations that humans should not need to remember.

## 19.1 CI MUST fail for protected invariants

Where technically practical, CI MUST fail for:

- unauthorized feature dependency edges;
- IPC bypasses;
- frontend/backend contract drift;
- invalid public contract exports;
- schema/migration inconsistencies;
- missing required i18n keys;
- type-check/build failures;
- lint failures required by the repository configuration;
- known architecture-graph violations.

## 19.2 CI SHOULD warn for guidance

CI SHOULD prefer warnings rather than failures for non-essential conventions such as:

- optional failure-mode documentation;
- missing traces in trivial code;
- implementation-shape preferences;
- other SHOULD-level recommendations.

## 19.3 Tooling

The repository may use tooling such as:

| Concern             | Example tooling                                    |
| ------------------- | -------------------------------------------------- |
| Type safety         | TypeScript                                         |
| Rust correctness    | cargo check / clippy                               |
| Linting             | ESLint and/or approved project linter              |
| Architecture        | dependency-cruiser or equivalent                   |
| Git hygiene         | Husky or equivalent                                |
| Contract validation | project validation scripts                         |
| Tests               | Vitest / Rust test framework / project equivalents |

Tool choice MAY change without requiring an architectural rewrite of this document.

---

# 20. Architecture Drift Prevention

The repository SHOULD continuously validate that the implementation matches the architecture declared here.

Where applicable, CI SHOULD check:

- feature dependency graph against feature manifests;
- IPC ↔ Rust ↔ contracts alignment;
- public API exports against manifest declarations;
- persistence schema versions and migrations;
- store ownership and isolation rules;
- generated architecture metadata is up to date.

Generated files used for architecture enforcement MUST have a reproducible generation process.

Do not manually edit generated architecture metadata unless the repository explicitly requires it.

---

# 21. Documentation and Architectural Decisions

Not every code change needs a document.

Documentation SHOULD be updated when a change affects:

- public behavior;
- setup/build requirements;
- user-visible limitations;
- security/privacy guarantees;
- architectural boundaries;
- migration/upgrade behavior.

## 21.1 ADRs

An Architecture Decision Record (ADR) SHOULD be used for Tier 3 changes.

Typical Tier 3 changes include:

- introducing/removing an architectural layer;
- changing feature dependency direction;
- changing the IPC boundary;
- changing persistence architecture;
- changing the offline/security boundary;
- replacing a foundational state or AI integration model.

An ADR should explain:

```text
Context
Decision
Alternatives considered
Consequences
Migration/rollback considerations
```

---

# 22. Change Management

## Tier 1 — Local

Typical examples:

- UI changes;
- bug fixes;
- internal refactors;
- tests;
- documentation.

These normally require standard code review and automated checks.

## Tier 2 — Contract

Typical examples:

- IPC changes;
- contract changes;
- persistent schema changes;
- public feature API changes;
- shared-state behavior changes.

These require appropriate tests, migration/compatibility consideration, and focused review.

## Tier 3 — Architectural

Typical examples:

- feature boundary changes;
- dependency-direction changes;
- new foundational infrastructure;
- IPC architecture changes;
- persistence architecture changes;
- offline/security boundary changes.

These require an ADR or equivalent architectural decision record.

---

# 23. Dependencies and Abstractions

## 23.1 Avoid unnecessary dependencies

A new dependency SHOULD be introduced only when it provides meaningful value that is not reasonably achieved with existing project capabilities.

Before adding one, consider:

- whether existing code already solves the problem;
- maintenance and release cadence;
- license;
- bundle/build cost;
- offline behavior;
- security/supply-chain risk;
- platform compatibility.

## 23.2 Avoid premature abstractions

Do not create an abstraction merely because several lines look similar.

Prefer duplication over a misleading abstraction when the behavior is not yet stable.

Create a shared abstraction when:

- the concept has a clear ownership boundary;
- reuse is real rather than speculative;
- the abstraction reduces complexity instead of hiding it.

---

# 24. Contributor Freedom

These standards are intended to protect the project, not restrict legitimate engineering choices.

## 24.1 Implementation freedom

Contributors are free to choose among reasonable implementations inside an approved boundary.

For example:

- the architecture may require a service boundary without prescribing one synchronization primitive;
- the architecture may require a feature API without prescribing the exact internal hook structure;
- the architecture may require offline behavior without prescribing one local transport mechanism.

## 24.2 Existing patterns first

Before introducing a new architectural pattern, contributors SHOULD look for an existing solution in the repository.

## 24.3 Smallest safe solution

When a change can be solved locally, prefer the local solution over a cross-cutting refactor.

## 24.4 Exceptions

A contributor may propose an exception when following a rule would:

- create unnecessary complexity;
- reduce correctness;
- harm performance materially;
- prevent an appropriate platform-specific implementation;
- make the code less maintainable.

The PR should explain the reason and the affected boundary.

Architecture exceptions MUST be explicit; they should not become undocumented precedent.

---

# 25. Definition of Done

A change is normally complete when applicable checks include:

- build succeeds;
- type checks succeed;
- relevant tests pass;
- architecture checks pass;
- contract checks pass when contracts changed;
- migrations exist when persistent schemas changed;
- user-visible strings use the correct i18n path;
- error behavior is appropriate;
- security/privacy implications were considered;
- documentation is updated when user-facing or architectural behavior changed;
- the pull request explains intentional deviations from SHOULD-level guidance.

Not every item applies to every change.

---

# 26. AI-Assisted Development

AI coding tools are allowed and should be treated as engineering tools, not as a separate class of code.

AI-generated or AI-modified code MUST follow the same architecture, security, testing, and review requirements as human-written code.

AI tooling MUST NOT introduce:

- external network access that violates the offline model;
- secrets or credentials;
- undeclared dependencies;
- undocumented architecture changes;
- copied third-party code with incompatible licensing.

For non-trivial AI-assisted changes, contributors SHOULD provide:

- intent summary;
- affected modules;
- important design decisions;
- tests run;
- risk/rollback considerations when relevant.

A full patch/diff SHOULD be provided when the review surface is non-trivial, but is unnecessary for obvious one-line edits.

AI-generated code MUST remain understandable and maintainable by human contributors.

---

# 27. Review Checklist for Architectural Changes

Reviewers SHOULD ask:

### Boundary

- Does the change preserve the frontend/backend boundary?
- Is filesystem/system access still controlled by Rust?
- Does IPC remain centralized and typed?
- Are feature dependencies explicit?

### Data

- Is persisted data versioned?
- Is migration/recovery behavior defined?
- Is sensitive data protected from logs and diagnostics?

### Offline/privacy

- Does the change introduce network capability?
- Does any new dependency contact remote services?
- Could the application silently send data outside the machine?

### Reliability

- What happens on startup failure?
- What happens on cancellation?
- What happens when Ollama/model/filesystem/database operations fail?
- Does the feature recover cleanly from partial operations?

### Maintainability

- Is the implementation simpler than the alternative?
- Is a new abstraction actually justified?
- Could an existing pattern be reused?
- Is the public API narrower than the internal implementation?

### Validation

- Can the important behavior be tested?
- Can architectural violations be automated?
- Are any remaining risks documented for reviewers?

---

# 28. Final Principles

1. **Protect boundaries, not personal preferences.**
2. **Prefer simple code over unnecessary architecture.**
3. **Make contracts explicit and machine-checkable.**
4. **Keep user data local by default.**
5. **Treat failures, cancellation, and recovery as normal design cases.**
6. **Use automation for invariants and human review for judgment.**
7. **Document architectural decisions without documenting every implementation detail.**
8. **A good contribution should fit the architecture without requiring the contributor to understand the entire codebase.**
9. **Standards should help the project evolve, not prevent it from evolving.**

> **Final rule:** If a critical requirement cannot be reliably validated by CI, tests, static analysis, or code review, define the appropriate validation method rather than pretending that the requirement is automatically enforced.
