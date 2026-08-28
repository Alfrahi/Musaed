# RAG Feature

## Purpose

Provides Retrieval-Augmented Generation (RAG) capabilities — project management, document indexing, hybrid search (BM25 + vector), context assembly, and file browsing. Enables the assistant to ground responses in user-provided documents.

## Public API (`index.ts`)

### Hooks

| Export                  | Source                           | Description                                                 |
| ----------------------- | -------------------------------- | ----------------------------------------------------------- |
| `useRagProjects`        | `hooks/useRagProjects.ts`        | CRUD operations for RAG projects                            |
| `useRagIndexing`        | `hooks/useRagIndexing.ts`        | Start/abort/reindex project indexing with progress tracking |
| `useRagSearch`          | `hooks/useRagSearch.ts`          | Hybrid search (BM25 + vector) with result ranking           |
| `useRagAssembleContext` | `hooks/useRagAssembleContext.ts` | Assemble context from search results within token budgets   |
| `useRagFileBrowser`     | `hooks/useRagFileBrowser.ts`     | Browse indexed files and inspect chunks                     |

### Components

| Export             | Source                            | Description                                           |
| ------------------ | --------------------------------- | ----------------------------------------------------- |
| `ProjectList`      | `components/ProjectList.tsx`      | List of RAG projects with selection                   |
| `AddProjectDialog` | `components/AddProjectDialog.tsx` | Dialog for adding a new RAG project                   |
| `RagExplorer`      | `components/RagExplorer.tsx`      | Top-level RAG UI — project list, search, file browser |
| `ProjectSettings`  | `components/ProjectSettings.tsx`  | Per-project settings (embedding model, reindex)       |
| `FileChunkViewer`  | `components/FileChunkViewer.tsx`  | Inspect individual chunks of a file                   |
| `RagContextBadge`  | `components/RagContextBadge.tsx`  | Badge showing RAG context status                      |

### Utils

| Export                | Source                     | Description                               |
| --------------------- | -------------------------- | ----------------------------------------- |
| `fileNameFromPath`    | `utils/project-helpers.ts` | Extract filename from a full path         |
| `truncateFilePath`    | `utils/project-helpers.ts` | Truncate long file paths with ellipsis    |
| `deriveProjectStatus` | `utils/project-helpers.ts` | Derive display status from indexing state |
| `ProjectStatusPatch`  | `utils/project-helpers.ts` | Type for project status patch operations  |

### Feature Manifest

| Export       | Source                | Description                                                      |
| ------------ | --------------------- | ---------------------------------------------------------------- |
| `RagFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

The components below live in `components/` but are **not** re-exported from `index.ts` (per DDD rules). They are mounted internally by the exported components above — `RagExplorer` (exported) composes `ProjectList`, `SearchResults`, `FileBrowser`, and `IndexingProgress`; `ProjectList` (exported) composes `ProjectCard`.

| Component          | Description                                 |
| ------------------ | ------------------------------------------- |
| `ProjectCard`      | Individual project card with index status   |
| `IndexingProgress` | Progress bar for active indexing operations |
| `SearchResults`    | Ranked search results display               |
| `FileBrowser`      | Browse files within an indexed project      |

## RagContextBadge Cross-Feature Usage

`RagContextBadge` lives inside this feature (`components/RagContextBadge.tsx`) and is exported from `index.ts`. It is consumed by the conversation feature's `InputArea`, which imports it via the public barrel to avoid reaching into `features/rag` internals. The badge owns the inactive-state CTA ("Add RAG Project") that routes the user to the sidebar Projects tab via the shared `useSidebarTab` action in `ui-store`, and the active-state explorer button that opens `RagExplorer` in a `ModalLayout`.

## IPC Endpoints

| Command                       | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `cmd_rag_add_project`         | Add a new RAG project                         |
| `cmd_rag_remove_project`      | Remove a project and its index                |
| `cmd_rag_update_project`      | Update project metadata                       |
| `cmd_rag_list_projects`       | List all RAG projects                         |
| `cmd_rag_index_project`       | Start async indexing for a project            |
| `cmd_rag_abort_index`         | Abort an active indexing operation            |
| `cmd_rag_reindex_project`     | Reindex an existing project                   |
| `cmd_rag_retry_index_project` | Retry indexing a failed project               |
| `cmd_rag_search`              | Hybrid BM25 + vector search                   |
| `cmd_rag_assemble_context`    | Assemble search results into a context string |
| `cmd_rag_get_file_chunks`     | Get chunks for a specific file                |
| `cmd_rag_list_files`          | List indexed files in a project               |
| `cmd_rag_set_embedding_model` | Set the embedding model for a project         |
| `cmd_dialog_open_file`        | Open file dialog for project selection        |

## State Schemas

| Store      | Version | Persistence Key |
| ---------- | ------- | --------------- |
| `ragStore` | 3       | `rag-state`     |

## Dependencies

- `library` — accesses model management for embedding model selection via the `library` feature barrel.

## Example Usage

```tsx
import { useRagProjects, useRagSearch } from '@/features/rag';

function RagPanel() {
  const { projects, addNewProject, removeProjectById } = useRagProjects();
  const { search } = useRagSearch();

  const handleSearch = async (query: string) => {
    await search({ query, projectId: projects[0]?.id });
  };

  return (
    <div>
      {projects.map((p) => (
        <div key={p.id}>{p.name}</div>
      ))}
    </div>
  );
}
```

> **Note:** Search results are written to the global `ragStore` (`useRagSearch` returns `{ search, clearResults }`, not the results array — read `useRagSearchResults()` from `@/store/rag-store` to render them).

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../../../docs/tauri-ipc-enforcement.md)
