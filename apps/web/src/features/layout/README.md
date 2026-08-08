# Layout Feature

## Purpose

Serves as the **composition root** for the entire application UI. Mounts the conversation, sidebar, settings, library, info, and search features and orchestrates their layout. RAG functionality is surfaced indirectly via the conversation feature's `InputArea` (which mounts `RagContextBadge`) and the sidebar's Projects tab — it is not imported directly by `layout`.

## Public API (`index.ts`)

### Components

| Export           | Source                          | Description                                                                                            |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `HomeClient`     | `components/HomeClient.tsx`     | Main application shell — mounts sidebar, chat window, model library, settings, info, and search modals |
| `CommandPalette` | `components/CommandPalette.tsx` | Global command palette for quick actions                                                               |

### Feature Manifest

| Export          | Source                | Description                                    |
| --------------- | --------------------- | ---------------------------------------------- |
| `LayoutFeature` | `feature.manifest.ts` | Feature manifest with composition dependencies |

## IPC Endpoints

None — `layout` is the composition root and declares no IPC endpoints of its own (see `feature.manifest.ts`). All IPC commands are owned by the features it mounts.

## State Schemas

None — uses global stores from other features, no feature-specific state.

## Dependencies

- `conversation` — mounts chat window and input
- `sidebar` — mounts conversation sidebar
- `settings` — imports SettingsModal
- `library` — imports ModelLibrary
- `info` — imports InfoModal
- `search` — imports SearchModal

> **Note:** `layout` is the composition root and is explicitly **exempt** from the cross-feature import rule. It imports other features via their `index.ts` public APIs to mount them.

## Example Usage

```tsx
import { HomeClient } from '@/features/layout';

// Typically used as the root client component
export default function Page() {
  return <HomeClient />;
}
```

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../../../docs/tauri-ipc-enforcement.md)
