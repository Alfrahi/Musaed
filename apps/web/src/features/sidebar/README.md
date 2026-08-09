# Sidebar Feature

## Purpose

Renders the conversation sidebar — conversation list with grouping by time, search, export to Markdown, and new conversation actions. Reads from the shared conversation and message stores via coordination hooks.

## Public API (`index.ts`)

### Components

| Export             | Source                            | Description                                              |
| ------------------ | --------------------------------- | -------------------------------------------------------- |
| `Sidebar`          | `components/Sidebar.tsx`          | Full sidebar container — search, conversation list, info |
| `SidebarSkeleton`  | `components/SidebarSkeleton.tsx`  | Loading skeleton for the sidebar                         |
| `SidebarHeader`    | `components/SidebarHeader.tsx`    | Header section with logo and actions                     |
| `SidebarInfo`      | `components/SidebarInfo.tsx`      | Info section at sidebar bottom                           |
| `SearchInput`      | `components/SearchInput.tsx`      | Search input with debounced filtering                    |
| `ConversationItem` | `components/ConversationItem.tsx` | Individual conversation row with context menu            |

### Hooks

| Export               | Source                        | Description                                           |
| -------------------- | ----------------------------- | ----------------------------------------------------- |
| `useSidebarActions`  | `hooks/useSidebarActions.ts`  | Actions: new conversation, delete, rename, export     |
| `useSidebarGrouping` | `hooks/useSidebarGrouping.ts` | Groups conversations by time (Today, Yesterday, etc.) |

### Utils

| Export             | Source            | Description                              |
| ------------------ | ----------------- | ---------------------------------------- |
| `exportToMarkdown` | `utils/export.ts` | Export a conversation to Markdown format |

### Types

| Export        | Source                        | Description                   |
| ------------- | ----------------------------- | ----------------------------- |
| `SidebarItem` | `hooks/useSidebarGrouping.ts` | Item type for sidebar display |
| `TimeGroup`   | `hooks/useSidebarGrouping.ts` | Time-based grouping category  |

### Feature Manifest

| Export           | Source                | Description                                                      |
| ---------------- | --------------------- | ---------------------------------------------------------------- |
| `SidebarFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

| Component             | Description                                        |
| --------------------- | -------------------------------------------------- |
| `SidebarResizeHandle` | Drag handle for resizing sidebar width (persisted) |

## IPC Endpoints

| Command                  | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `cmd_dialog_ask`         | Confirmation dialogs for delete/clear actions |
| `cmd_dialog_save_file`   | File save dialog for Markdown export          |
| `cmd_fs_write_text_file` | Write the exported Markdown file to disk      |

All three IPC endpoints are declared in `feature.manifest.ts`. `cmd_dialog_ask` is consumed via `dialogApi.ask` in `hooks/useSidebarActions.ts`; the other two are used by `utils/export.ts`.

## State Schemas

The sidebar feature does not own any stores. It reads from global stores owned by the `conversation` feature and persisted by the Rust backend.

| Store               | Version | Persistence                                                    |
| ------------------- | ------- | -------------------------------------------------------------- |
| `conversationStore` | 3       | Persisted by the Rust backend (SQLite). No zustand persist.    |
| `messageStore`      | 0       | In-memory cache only — messages persisted by the Rust backend. |

> **Note:** These stores live in `@/store/` (not inside the conversation feature folder). The sidebar reads them via selector hooks (`useCurrentConversationId`, `useFilteredConversations`, `useSearchQuery`, etc.) declared in `@/store/conversation-store.ts`.

## Dependencies

- `conversation` — reads conversation list and metadata via store selector hooks; uses `useConversationActions` for CRUD
- `rag` — accesses RAG functionality for the Projects tab in the sidebar
- `settings` — reads theme and i18n settings via `useSettingsStore` (global store, not a feature import)

> **Note:** The sidebar is the conversation-list composition layer. The manifest declares `dependencies: ['conversation', 'rag']`; explicit settings-store access is global and not counted as a feature import for dep-cruiser purposes.

## Example Usage

```tsx
import { Sidebar } from '@/features/sidebar';

function AppLayout() {
  return (
    <div className="flex">
      <Sidebar />
      <main>{/* chat content */}</main>
    </div>
  );
}
```

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
