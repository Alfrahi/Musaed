import { callInternal } from './transport';
import type { CommandMap } from '@musaed/contracts';

/**
 * RAG (Retrieval-Augmented Generation) API - manages project indexing and semantic search.
 */
export const ragApi = {
  /**
   * Creates a new RAG project by registering a folder path and embedding model.
   * @param args - { name, path, embeddingModel, ignorePatterns[] }
   * @returns The created RagProject object or null on failure
   */
  addProject: (args: CommandMap['cmd_rag_add_project']['args']) =>
    callInternal('cmd_rag_add_project', args),
  /**
   * Removes a RAG project (does not delete files on disk).
   * @param projectId - The unique project identifier
   * @returns true if removal succeeded, false otherwise
   */
  removeProject: (projectId: string) => callInternal('cmd_rag_remove_project', { projectId }),
  /**
   * Updates an existing project's name or ignore patterns.
   * @param args - { projectId, name?, ignorePatterns? }
   * @returns The updated RagProject object or null on failure
   */
  updateProject: (args: CommandMap['cmd_rag_update_project']['args']) =>
    callInternal('cmd_rag_update_project', args),
  /**
   * Lists all registered RAG projects.
   * @returns Array of RagProject objects
   */
  listProjects: () => callInternal('cmd_rag_list_projects', {}),
  /**
   * Triggers indexing of all files in a project.
   * @param projectId - The project identifier
   * @param force - If true, reindexes already indexed files
   * @param baseUrl - Optional Ollama base URL for embedding
   * @returns true if indexing started, false otherwise
   */
  indexProject: (projectId: string, force?: boolean, baseUrl?: string) =>
    callInternal('cmd_rag_index_project', { projectId, force, baseUrl }),
  /**
   * Aborts an ongoing indexing operation.
   * @param projectId - The project identifier
   * @returns true if abort was signaled, false otherwise
   */
  abortIndex: (projectId: string) => callInternal('cmd_rag_abort_index', { projectId }),
  /**
   * Reindexes a project (shortcut for abort + index).
   * @param projectId - The project identifier
   * @param baseUrl - Optional Ollama base URL for embedding
   * @returns true if reindexing started, false otherwise
   */
  reindexProject: (projectId: string, baseUrl?: string) =>
    callInternal('cmd_rag_reindex_project', { projectId, baseUrl }),
  /**
   * Retries a failed indexing operation for a project.
   * @param projectId - The project identifier
   * @param baseUrl - Optional Ollama base URL (uses default if omitted)
   * @returns true if retry started successfully, false otherwise
   */
  retryIndexProject: (projectId: string, baseUrl?: string) =>
    callInternal('cmd_rag_retry_index_project', { projectId, baseUrl }),
  /**
   * Performs a semantic search over indexed content.
   * @param args - { projectId, query, topK?, threshold?, baseUrl? }
   * @returns Array of SearchResult with matched chunks and scores
   */
  search: (args: CommandMap['cmd_rag_search']['args']) => callInternal('cmd_rag_search', args),
  /**
   * Fetches all chunk records for a specific file within a project.
   * @param projectId - The project identifier
   * @param filePath - Absolute path to the file
   * @returns Array of ChunkRecord objects
   */
  getFileChunks: (projectId: string, filePath: string) =>
    callInternal('cmd_rag_get_file_chunks', { projectId, filePath }),
  /**
   * Lists all indexed files for a project.
   * @param projectId - The project identifier
   * @returns Array of FileRecord objects with file paths and metadata
   */
  listFiles: (projectId: string) => callInternal('cmd_rag_list_files', { projectId }),
  /**
   * Changes the embedding model used by a project.
   * @param projectId - The project identifier
   * @param modelName - Name of the embedding model to switch to
   * @returns true if model was updated successfully, false otherwise
   */
  setEmbeddingModel: (projectId: string, modelName: string) =>
    callInternal('cmd_rag_set_embedding_model', { projectId, modelName }),
  /**
   * Performs semantic search and assembles a RAG context in a single IPC call.
   * Replaces the previous two-step process of search + client-side context assembly.
   * @param args - { projectId, query, topK?, threshold?, maxChars?, baseUrl? }
   * @returns AssembledContext with the formatted context string, citations, and token count
   */
  assembleContext: (args: CommandMap['cmd_rag_assemble_context']['args']) =>
    callInternal('cmd_rag_assemble_context', args),
};
