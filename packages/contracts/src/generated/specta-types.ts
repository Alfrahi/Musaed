// Hand-maintained Specta-style type stubs.
//
// Musaed has not yet adopted Specta (see AUDIT-REPORT.md Quick Win #3 and
// the Tier-3 follow-up in FIX.md Prompt 4). Until the toolchain is added,
// the canonical contract source of truth remains:
//
//   - Rust:     `src-tauri/src/<domain>/commands.rs`
//   - TS Map:   `apps/web/src/lib/ipc.ts` (`CommandMap`)
//   - TS Types: `apps/web/src/lib/ipc.ts` (re-exports from `@musaed/contracts`)
//
// The machine validator that bridges Rust ↔ CommandMap lives at
// `scripts/validate-contracts.mjs` and is invoked via:
//
//   pnpm validate:contracts           # baseline: name + arg-count checks
//   pnpm validate:contracts --strict  # Tier 3: TYPE_MISMATCH checks (opt-in)
//
// WHEN SPECTA IS INTRODUCED: replace this file with the generated
// `specta::serde_types!` output and delete the manual sync.

export type UnusedUntilSpectaLands = never;
