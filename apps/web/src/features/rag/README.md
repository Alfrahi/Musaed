# RAG Feature

## Purpose

Provides Retrieval-Augmented Generation (RAG) capabilities — project management, document indexing, hybrid search (BM25 + vector), context assembly, and file browsing. Enables the assistant to ground responses in user-provided documents.

## Public API (`index.ts`)

### Hooks

| Export              | Source                       | Description                                                 |
| ------------------- | ---------------------------- | ----------------------------------------------------------- |
| `useRagProjects`    | `hooks/useRagProjects.ts`    | CRUD operations for RAG projects                            |
| `useRagIndexing`    | `hooks/useRagIndexing.ts`    | Start/abort/reindex project indexing with progress tracking |
| `useRagSearch`      | `hooks/useRagSearch.ts`      | Hybrid search (BM25 + vector) with result ranking           |
| `useRagContext`     | `hooks/useRagContext.ts`     | Assemble context from search results within token budgets   |
| `useRagFileBrowser` | `hooks/useRagFileBrowser.ts` | Browse indexed files and inspect chunks                     |

### Utils

| Export                | Source                     | Description                               |
| --------------------- | -------------------------- | ----------------------------------------- |
| `fileNameFromPath`    | `utils/project-helpers.ts` | Extract filename from a full path         |
| `truncateFilePath`    | `utils/project-helpers.ts` | Truncate long file paths with ellipsis    |
| `getRelativeFilePath` | `utils/project-helpers.ts` | Convert absolute path to project-relative |

### Feature Manifest

| Export       | Source                | Description                                                      |
| ------------ | --------------------- | ---------------------------------------------------------------- |
| `RagFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

Components live in `components/` and are **not** re-exported from `index.ts` (per DDD rules). They are mounted by the `layout` composition layer.

| Component          | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `RagExplorer`      | Top-level RAG UI — project list, search, file browser |
| `ProjectList`      | List of RAG projects with selection                   |
| `ProjectCard`      | Individual project card with index status             |
| `ProjectSettings`  | Per-project settings (embedding model, reindex)       |
| `AddProjectDialog` | Dialog for adding a new RAG project                   |
| `IndexingProgress` | Progress bar for active indexing operations           |
| `SearchResults`    | Ranked search results display                         |
| `FileBrowser`      | Browse files within an indexed project                |
| `FileChunkViewer`  | Inspect individual chunks of a file                   |

## Components Mounted Outside This Feature

The chat-input badge is rendered by `RagContextBadge` in `src/components/ui/`, not by a
component in this feature. It lives outside `features/rag` so that the conversation
feature's `InputArea` can mount it without crossing the feature boundary (STANDARDS §3).
The badge owns the inactive-state CTA ("Add RAG Project") that routes the user to the
sidebar Projects tab via the shared `useSidebarTab` action in `ui-store`, and the
active-state explorer button that opens `RagExplorer` in a `ModalLayout`.

## IPC Endpoints

| Command                            | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| `cmd_rag_add_project`              | Add a new RAG project                         |
| `cmd_rag_remove_project`           | Remove a project and its index                |
| `cmd_rag_update_project`           | Update project metadata                       |
| `cmd_rag_list_projects`            | List all RAG projects                         |
| `cmd_rag_get_project`              | Get a single project by ID                    |
| `cmd_rag_index_project`            | Start async indexing for a project            |
| `cmd_rag_abort_index`              | Abort an active indexing operation            |
| `cmd_rag_reindex_project`          | Reindex an existing project                   |
| `cmd_rag_get_index_status`         | Poll indexing progress                        |
| `cmd_rag_search`                   | Hybrid BM25 + vector search                   |
| `cmd_rag_assemble_context`         | Assemble search results into a context string |
| `cmd_rag_get_file_chunks`          | Get chunks for a specific file                |
| `cmd_rag_get_project_stats`        | Get indexing statistics for a project         |
| `cmd_rag_set_embedding_model`      | Set the embedding model for a project         |
| `cmd_rag_validate_embedding_model` | Validate an embedding model name              |

## State Schemas

| Store      | Version | Persistence Key         |
| ---------- | ------- | ----------------------- |
| `ragStore` | 1       | `musaed-rag-storage-v1` |

## Example Usage

```tsx
import { useRagProjects, useRagSearch } from '@/features/rag';

function RagPanel() {
  const { projects, addProject, removeProject } = useRagProjects();
  const { results, search } = useRagSearch();

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

## Related Docs

- [Migration Framework](../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../docs/tauri-ipc-enforcement.md)
