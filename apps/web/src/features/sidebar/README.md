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

## IPC Endpoints

| Command               | Purpose                              |
| --------------------- | ------------------------------------ |
| `cmd_dialog_ask`      | Confirmation dialogs (delete, clear) |
| `cmd_export_markdown` | Export conversation to Markdown file |

## State Schemas

| Store               | Version | Persistence Key                  |
| ------------------- | ------- | -------------------------------- |
| `conversationStore` | 3       | `musaed-conversation-storage-v2` |
| `messageStore`      | 1       | `musaed-message-storage-v1`      |

> **Note:** The sidebar feature does not own these stores — it reads from the `conversation` feature's stores via coordination hooks (`useCurrentConversationId`, `useFilteredConversations`, etc.).

## Dependencies

None — no direct feature imports. Uses coordination hooks from `lib/` to communicate with shared stores.

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

- [Migration Framework](../../../docs/migration-framework.md)
