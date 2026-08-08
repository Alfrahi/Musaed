# Search Feature

## Purpose

Provides message-level full-text search across all conversations. The search modal queries the Rust backend via `cmd_conversation_search` and navigates to the selected conversation on result click. Mounted by the `layout` composition layer alongside the other global modals.

## Public API (`index.ts`)

### Components

| Export        | Source                       | Description                                                                      |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `SearchModal` | `components/SearchModal.tsx` | Modal dialog with debounced query input, ranked results, and keyboard navigation |

### Hooks

| Export             | Source                      | Description                                         |
| ------------------ | --------------------------- | --------------------------------------------------- |
| `useMessageSearch` | `hooks/useMessageSearch.ts` | Debounced search (300 ms) with stale-response guard |

### Feature Manifest

| Export          | Source                | Description                                                      |
| --------------- | --------------------- | ---------------------------------------------------------------- |
| `SearchFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoint, and dependencies |

## Key Components (internal)

| Component           | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `SearchResultItem`  | Single result row with conversation title, role badge, and snippet |
| `SearchInput`       | Query input with ARIA combobox semantics and loading spinner       |
| `SearchResultsList` | Results list with ARIA `listbox` role, empty/error/loading states  |

All three are memoized internal components inside `components/SearchModal.tsx` — they are **not** re-exported from `index.ts`.

## IPC Endpoints

| Command                   | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `cmd_conversation_search` | Full-text search across all conversations' messages |

> **Note:** The hook debounces queries by 300 ms and uses a monotonic request counter so stale responses from an earlier query cannot overwrite newer results.

## State Schemas

None — this is a stateless UI-only feature. The query string and results live in local `useMessageSearch` state; no global Zustand store is owned.

## Dependencies

- `conversation` — `SearchModal` calls `useSetCurrentConversationId` to navigate to the selected conversation result.

> **Note:** `SearchModal` also reads `useSettingsStore` for the active language, but global-store access is not counted as a feature import for dep-cruiser purposes (see STANDARDS §3).

## Example Usage

```tsx
import { SearchModal } from '@/features/search';

function App({
  isSearchOpen,
  onCloseSearch,
}: {
  isSearchOpen: boolean;
  onCloseSearch: () => void;
}) {
  return <SearchModal isOpen={isSearchOpen} onClose={onCloseSearch} />;
}
```

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../../../docs/tauri-ipc-enforcement.md)
