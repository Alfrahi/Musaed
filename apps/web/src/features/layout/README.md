# Layout Feature

## Purpose

Serves as the **composition root** for the entire application UI. Mounts all other features (conversation, sidebar, RAG, settings, library) and orchestrates their layout. This is the only feature exempt from cross-feature import rules — it exists to wire features together.

## Public API (`index.ts`)

### Components

| Export       | Source                      | Description                                                                    |
| ------------ | --------------------------- | ------------------------------------------------------------------------------ |
| `HomeClient` | `components/HomeClient.tsx` | Main application shell — mounts sidebar, chat window, modals, and RAG explorer |

### Feature Manifest

| Export          | Source                | Description                                    |
| --------------- | --------------------- | ---------------------------------------------- |
| `LayoutFeature` | `feature.manifest.ts` | Feature manifest with composition dependencies |

## IPC Endpoints

| Command                 | Purpose                           |
| ----------------------- | --------------------------------- |
| `cmd_ollama_chat`       | Delegated to conversation feature |
| `cmd_ollama_abort_chat` | Delegated to conversation feature |
| `cmd_message_append`    | Delegated to message store        |

## State Schemas

None — uses global stores from other features, no feature-specific state.

## Dependencies

- `chat` (conversation) — mounts chat window and input
- `sidebar` — mounts conversation sidebar

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

- [Migration Framework](../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../docs/tauri-ipc-enforcement.md)
