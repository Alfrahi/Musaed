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
      'useRagContext',
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
    utils: ['fileNameFromPath', 'truncateFilePath', 'getRelativeFilePath'],
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
    'cmd_rag_set_embedding_model',
    // Cross-feature IPC: ProjectSettings needs embedding model list.
    // TODO: route through library's public API to eliminate dual-ownership
    // (CodebaseAudits/Architecture.md Finding 2a/2b)
    'cmd_ollama_get_models',
  ],
  /**
   * Performance-sensitive IPC endpoints owned by this feature. The actual
   * thresholds (ms) live in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: ['cmd_rag_list_projects'],
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
  persistenceSchemas: {
    rag: 'rag-state',
  },
  dependencies: ['library'],
} as const;

export default manifest;
