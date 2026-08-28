/**
 * RAG Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'rag',
  version: '1.0.0',
  publicApi: {
    hooks: [
      'useRagProjects',
      'useRagIndexing',
      'useRagSearch',
      'useRagAssembleContext',
      'useRagFileBrowser',
    ],
    components: [
      'ProjectList',
      'AddProjectDialog',
      'RagExplorer',
      'ProjectSettings',
      'FileChunkViewer',
      'RagContextBadge',
    ],
    utils: ['fileNameFromPath', 'truncateFilePath', 'deriveProjectStatus'],
  },
  ipcEndpoints: [
    'cmd_rag_add_project',
    'cmd_rag_remove_project',
    'cmd_rag_update_project',
    'cmd_rag_list_projects',
    'cmd_rag_index_project',
    'cmd_rag_abort_index',
    'cmd_rag_reindex_project',
    'cmd_rag_retry_index_project',
    'cmd_rag_search',
    'cmd_rag_assemble_context',
    'cmd_rag_get_file_chunks',
    'cmd_rag_list_files',
    'cmd_rag_set_embedding_model',
    // `components/AddProjectDialog.tsx` opens a native directory picker via
    // the IPC-layer `dialogApi` namespace. Feature-scoped, not shared.
    'cmd_dialog_open_file',
  ],
  /**
   * Performance-sensitive IPC endpoints owned by this feature. The actual
   * thresholds (ms) live in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: ['cmd_rag_list_projects', 'cmd_rag_list_files'],
    heavy: [
      'cmd_rag_index_project',
      'cmd_rag_reindex_project',
      'cmd_rag_search',
      'cmd_rag_assemble_context',
    ],
  },
  stateSchemas: {
    ragStore: 3,
  },
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {
    cmd_rag_add_project: {
      fallback: 'Show error toast and keep the add-project dialog open',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_remove_project: {
      fallback: 'Show error toast; project remains in list',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_update_project: {
      fallback: 'Show error toast and revert to previous project settings',
      retry: 'once',
      messageKey: 'rag.failedToUpdateProject',
    },
    cmd_rag_list_projects: {
      fallback: 'Show empty project list with error banner',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_index_project: {
      fallback: 'Mark project as indexing-failed; show retry button',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_abort_index: {
      fallback: 'Silently ignore — abort is fire-and-forget',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_rag_reindex_project: {
      fallback: 'Mark project as indexing-failed; show retry button',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_retry_index_project: {
      fallback: 'Mark project as indexing-failed; show retry button again',
      retry: 'exponential',
      messageKey: 'error.genericError',
    },
    cmd_rag_search: {
      fallback: 'Show empty search results with error banner',
      retry: 'once',
      messageKey: 'error.rag.title',
    },
    cmd_rag_assemble_context: {
      fallback: 'Continue chat without RAG context — non-blocking',
      retry: 'none',
      messageKey: 'chat.ragContextFailed',
    },
    cmd_rag_get_file_chunks: {
      fallback: 'Show empty chunk list in FileChunkViewer',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_list_files: {
      fallback: 'Show empty file list in FileBrowser',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_rag_set_embedding_model: {
      fallback: 'Keep previous embedding model selection',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_dialog_open_file: {
      fallback: 'Keep the add-project dialog open with the previous path',
      retry: 'none',
      messageKey: 'error.genericError',
    },
  },
  dependencies: ['library'],
} as const;

export default manifest;
