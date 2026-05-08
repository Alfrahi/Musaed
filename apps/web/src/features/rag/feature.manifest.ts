/**
 * RAG Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

export default {
  name: 'rag',
  version: '1.0.0',
  publicApi: {
    components: [
      'ProjectList',
      'ProjectCard',
      'AddProjectDialog',
      'IndexingProgress',
      'RagContextBadge',
      'SearchResults',
      'FileBrowser',
      'FileChunkViewer',
      'RagExplorer',
      'ProjectSettings',
    ],
    hooks: [
      'useRagProjects',
      'useRagIndexing',
      'useRagSearch',
      'useRagContext',
      'useRagFileBrowser',
    ],
    utils: [
      'buildRagSystemContext',
      'formatFileSize',
      'fileNameFromPath',
      'truncateFilePath',
      'getRelativeFilePath',
    ],
  },
  ipcEndpoints: [
    'cmd_rag_add_project',
    'cmd_rag_remove_project',
    'cmd_rag_update_project',
    'cmd_rag_list_projects',
    'cmd_rag_get_project',
    'cmd_rag_index_project',
    'cmd_rag_abort_index',
    'cmd_rag_reindex_project',
    'cmd_rag_get_index_status',
    'cmd_rag_search',
    'cmd_rag_get_file_chunks',
    'cmd_rag_get_project_stats',
    'cmd_rag_set_embedding_model',
    'cmd_rag_validate_embedding_model',
  ],
  stateSchemas: {
    ragStore: 1,
  },
  persistenceSchemas: {
    rag: 'musaed-rag-storage-v1',
  },
  dependencies: [],
} as const;
