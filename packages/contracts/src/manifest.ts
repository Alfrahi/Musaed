/**
 * Feature Manifest Contract — shared type for feature.manifest.ts files.
 *
 * STANDARDS.md §4 (Feature Contract System) requires each feature to define:
 *   - public API surface
 *   - IPC endpoints used
 *   - state schema version
 *   - persistence schema version
 *   - dependency list
 *
 * This module provides the canonical `FeatureManifest` interface so every
 * manifest is typed against the same contract. CI validates manifests via
 * `scripts/validate-manifests.mjs`.
 *
 * @see STANDARDS.md §19 — Architecture Drift Prevention
 */

/**
 * A feature's public API surface — the hooks, components, and utilities
 * exported from its barrel (index.ts). The validator cross-checks these
 * names against the actual barrel exports.
 */
export interface FeaturePublicApi {
  /** Hook names exported from the feature barrel */
  hooks: readonly string[];
  /** Component names exported from the feature barrel */
  components: readonly string[];
  /** Utility function names exported from the feature barrel */
  utils: readonly string[];
}

/**
 * Latency profile category for an IPC endpoint.
 *
 * Mirrors the categories used in `IPC_LATENCY_BUDGETS` (packages/contracts/src/latency.ts).
 * The validator cross-checks that every command listed here has a non-zero budget.
 */
export type LatencyProfileCategory = 'interactive' | 'background' | 'heavy';

/**
 * Canonical Feature Manifest shape.
 *
 * Every feature.manifest.ts must export a default value conforming to this
 * interface. The `as const` assertion on the concrete object provides
 * literal-type narrowing while this interface ensures structural compliance.
 */
export interface FeatureManifest {
  /** Feature directory name (must match the directory under apps/web/src/features/) */
  name: string;

  /** Semantic version of the manifest itself (not the feature code) */
  version: string;

  /** Public API surface — hooks, components, and utils exported from the barrel */
  publicApi: FeaturePublicApi;

  /** IPC command names this feature invokes (must exist in CommandMap in ipc.ts) */
  ipcEndpoints: readonly string[];

  /**
   * Performance-sensitive IPC endpoints grouped by latency profile.
   * Every command listed here must have a non-zero entry in IPC_LATENCY_BUDGETS.
   *
   * Optional — features with no latency-sensitive IPC can omit this.
   */
  latencyProfiles?: Partial<Record<LatencyProfileCategory, readonly string[]>>;

  /**
   * State schema versions for Zustand stores owned by this feature.
   * Keys are store names, values are integer schema versions.
   */
  stateSchemas: Record<string, number>;

  /**
   * Persistence schema identifiers for Tauri plugin-store keys.
   * Keys are logical names, values are the store key strings.
   */
  persistenceSchemas: Record<string, string>;

  /**
   * Feature directory names this feature depends on.
   * Must match actual directory names under apps/web/src/features/.
   * Empty array means no dependencies.
   */
  dependencies: readonly string[];
}
