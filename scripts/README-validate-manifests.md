# validate-manifests.mjs

This script validates the consistency between feature manifests (`feature.manifest.ts`) and their corresponding stores and barrel exports, addressing the critical issues **C1** and **C3** from the architecture audit report.

## What it validates

1. **stateSchemas consistency**: Ensures the version declared in the manifest matches the actual store version (`version:` literal or `*_VERSION` constant).
2. **persistenceSchemas consistency**: Ensures the store name declared in the manifest matches the actual store `name:` literal.
3. **publicApi consistency**: Ensures hooks, components, and utils declared in the manifest are actually exported in `index.ts`. Supports both named and `default as` re-export patterns from `./components/*`, `./hooks/*`, `./utils/*`, and `@/store/*`.

## Audit findings addressed

### Critical Issue C1: Feature manifest vs. store version drift

- **Problem**: Manifests declared `stateSchemas` versions that didn't match the actual store versions.
- **Example (now fixed)**: `conversation/feature.manifest.ts` declared `conversationStore: 3` but `conversation-store.ts` has `version: 1`.
- **Solution**: The validator parses `stateSchemas` from each manifest, reads the `version:` (or `*_VERSION` constant) from the matching store file, and fails on mismatch. The mismatches surfaced by the validator have been corrected in the manifests.

### Critical Issue C3: persistenceSchemas manifest claimed non-existent store names

- **Problem**: Manifests declared `persistenceSchemas` with versioned names that didn't match actual store names.
- **Example (now fixed)**: `conversation/feature.manifest.ts` declared `'musaed-conversation-storage-v2'` but the store uses `'musaed-conversation-storage'`.
- **Solution**: The validator reads the `name:` literal from each matching store file and fails on mismatch. The name references in the manifests have been corrected.

### Special cases handled

- **messageStore**: Skipped for version checks because message state lives in the Rust backend (in-memory cache only).
- **message / messages** persistence keys: Skipped for name checks for the same reason.
- **conversation / conversations** persistence keys: Both map to `conversation-store.ts`.
- **models** persistence key: Maps to `model-store.ts`.

## How to use

```bash
# Run the validation
node scripts/validate-manifests.mjs

# The script is also integrated into the CI pipeline via:
pnpm validate:manifests
pnpm validate   # runs lint + type-check + i18n:check + validate:manifests
```

## What happens when validation fails

When inconsistencies are found:

1. The script outputs detailed error messages showing exactly what doesn't match.
2. The script exits with a non-zero status code.
3. CI fails, preventing the inconsistencies from being merged.

## Example output (all checks passing)

```
Validating feature: conversation
  ✅ Version match for conversationStore: 1
  ⚠️  messageStore is handled by Rust backend, skipping version check
  ✅ Version match for streamingStore: 2
  ✅ Name match for conversation: musaed-conversation-storage
  ✅ Hook 'useChatActions' is exported
  ✅ Util 'initializeConversations' is exported

Validating feature: library
  ✅ Version match for modelStore: 1
  ✅ Name match for models: musaed-model-storage
  ✅ Component 'ModelLibrary' is exported
  ✅ Component 'ModelCard' is exported
  ✅ Component 'ModelSelector' is exported

✅ All validations passed.
```

## Example of the errors the validator catches

```
❌ Version mismatch for conversationStore: manifest declares 3, store has 1
❌ Name mismatch for rag: manifest declares 'musaed-rag-storage-v1', store has 'rag-state'
❌ Component 'ProjectList' declared in manifest but not exported in index.ts
❌ Store file not found: conversation-store.ts
```

This script ensures that the architecture contract defined in STANDARDS.md §19 (Architecture Drift Prevention) is actually enforced, preventing silent drift between manifests and implementation.
