import { z } from 'zod';
import {
  ApiResponse,
  OllamaModel,
  ChatMessage,
  ChatSettings,
  OllamaHealthIpc,
  OllamaModelSchema,
  OllamaHealthIpcSchema,
  ModelValidation,
  ModelValidationSchema,
  ModelNameSchema,
  RequestIdSchema,
  LanguageSchema,
  IpcChatMessageSchema,
  IpcChatOptionsSchema,
  LogEntrySchema,
  VALIDATION_LIMITS,
  RagProjectSchema,
  SearchResultSchema,
  ProjectStatsSchema,
  ChunkRecordSchema,
  IndexStatusSchema,
  RagModelValidationSchema,
  RAG_VALIDATION_LIMITS,
} from '@musaed/contracts';
import type {
  RagProject,
  SearchResult,
  ProjectStats,
  ChunkRecord,
  IndexStatus,
  RagModelValidation,
} from '@musaed/contracts';
import toast from 'react-hot-toast';

export interface CommandMap {
  cmd_ollama_get_models: { args: { baseUrl: string }; return: OllamaModel[] };
  cmd_ollama_chat: {
    args: {
      baseUrl: string;
      model: string;
      messages: ChatMessage[];
      options: Partial<ChatSettings>;
      requestId: string;
    };
    return: boolean;
  };
  cmd_ollama_abort_chat: { args: { requestId: string }; return: void };
  cmd_ollama_delete_model: { args: { baseUrl: string; name: string }; return: boolean };
  cmd_ollama_pull_model: { args: { baseUrl: string; name: string }; return: void };
  cmd_ollama_check_health: { args: { baseUrl: string }; return: OllamaHealthIpc };
  cmd_ollama_verify_service: { args: { baseUrl: string }; return: string };
  cmd_ollama_generate_title: {
    args: {
      baseUrl: string;
      model: string;
      userMessage: string;
      assistantMessage: string;
      language: string;
    };
    return: string;
  };
  cmd_ollama_validate_model: {
    args: { baseUrl: string; modelName: string };
    return: ModelValidation;
  };
  cmd_logs_append: { args: { entry: string }; return: void };
  cmd_logs_clear: { args: Record<string, never>; return: void };

  // RAG commands
  cmd_rag_add_project: {
    args: { name: string; path: string; embeddingModel: string; ignorePatterns: string[] };
    return: RagProject;
  };
  cmd_rag_remove_project: { args: { projectId: string }; return: boolean };
  cmd_rag_update_project: {
    args: { projectId: string; name?: string; ignorePatterns?: string[] };
    return: RagProject;
  };
  cmd_rag_list_projects: { args: Record<string, never>; return: RagProject[] };
  cmd_rag_get_project: { args: { projectId: string }; return: RagProject };
  cmd_rag_index_project: {
    args: { projectId: string; force?: boolean; baseUrl?: string };
    return: boolean;
  };
  cmd_rag_abort_index: { args: { projectId: string }; return: boolean };
  cmd_rag_reindex_project: { args: { projectId: string; baseUrl?: string }; return: boolean };
  cmd_rag_get_index_status: { args: { projectId: string }; return: IndexStatus };
  cmd_rag_search: {
    args: { projectId: string; query: string; topK?: number; threshold?: number; baseUrl?: string };
    return: SearchResult[];
  };
  cmd_rag_get_file_chunks: { args: { projectId: string; filePath: string }; return: ChunkRecord[] };
  cmd_cmd_rag_get_project_stats: { args: { projectId: string }; return: ProjectStats };
  cmd_rag_set_embedding_model: { args: { projectId: string; modelName: string }; return: boolean };
  cmd_rag_validate_embedding_model: {
    args: { baseUrl?: string; modelName: string };
    return: RagModelValidation;
  };
}

const voidSchema = z.preprocess((val) => (val === null ? undefined : val), z.void());

/**
 * Input validation schemas for each command's args.
 * Undefined entries mean the args are trivially valid (e.g. empty object).
 */
const CommandInputSchemas: {
  [K in keyof CommandMap]: z.ZodType<CommandMap[K]['args']> | undefined;
} = {
  cmd_ollama_get_models: undefined,
  cmd_ollama_chat: z.object({
    baseUrl: z.string(),
    model: ModelNameSchema,
    messages: z
      .array(IpcChatMessageSchema)
      .max(VALIDATION_LIMITS.MAX_MESSAGES_COUNT, 'Too many messages'),
    options: IpcChatOptionsSchema,
    requestId: RequestIdSchema,
  }),
  cmd_ollama_abort_chat: z.object({ requestId: RequestIdSchema }),
  cmd_ollama_delete_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  cmd_ollama_pull_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  cmd_ollama_check_health: undefined,
  cmd_ollama_verify_service: undefined,
  cmd_ollama_generate_title: z.object({
    baseUrl: z.string(),
    model: ModelNameSchema,
    userMessage: z
      .string()
      .max(VALIDATION_LIMITS.MAX_TITLE_INPUT_LEN, 'userMessage exceeds size limit'),
    assistantMessage: z
      .string()
      .max(VALIDATION_LIMITS.MAX_TITLE_INPUT_LEN, 'assistantMessage exceeds size limit'),
    language: LanguageSchema,
  }),
  cmd_ollama_validate_model: z.object({ baseUrl: z.string(), modelName: ModelNameSchema }),
  cmd_logs_append: z.object({ entry: LogEntrySchema }),
  cmd_logs_clear: undefined,

  // RAG command input schemas
  cmd_rag_add_project: z.object({
    name: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_NAME_LEN),
    path: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_PATH_LEN),
    embeddingModel: ModelNameSchema,
    ignorePatterns: z
      .array(z.string().max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERN_LEN))
      .max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERNS),
  }),
  cmd_rag_remove_project: z.object({ projectId: z.string().min(1) }),
  cmd_rag_update_project: z.object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_NAME_LEN).optional(),
    ignorePatterns: z
      .array(z.string().max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERN_LEN))
      .max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERNS)
      .optional(),
  }),
  cmd_rag_list_projects: undefined,
  cmd_rag_get_project: z.object({ projectId: z.string().min(1) }),
  cmd_rag_index_project: z.object({
    projectId: z.string().min(1),
    force: z.boolean().optional(),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_abort_index: z.object({ projectId: z.string().min(1) }),
  cmd_rag_reindex_project: z.object({
    projectId: z.string().min(1),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_get_index_status: z.object({ projectId: z.string().min(1) }),
  cmd_rag_search: z.object({
    projectId: z.string().min(1),
    query: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_SEARCH_QUERY_LEN),
    topK: z
      .number()
      .int()
      .min(RAG_VALIDATION_LIMITS.MIN_TOP_K)
      .max(RAG_VALIDATION_LIMITS.MAX_TOP_K)
      .optional(),
    threshold: z
      .number()
      .min(RAG_VALIDATION_LIMITS.MIN_THRESHOLD)
      .max(RAG_VALIDATION_LIMITS.MAX_THRESHOLD)
      .optional(),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_get_file_chunks: z.object({
    projectId: z.string().min(1),
    filePath: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_PATH_LEN),
  }),
  cmd_cmd_rag_get_project_stats: z.object({ projectId: z.string().min(1) }),
  cmd_rag_set_embedding_model: z.object({
    projectId: z.string().min(1),
    modelName: ModelNameSchema,
  }),
  cmd_rag_validate_embedding_model: z.object({
    baseUrl: z.string(),
    modelName: ModelNameSchema,
  }),
};

const CommandReturnSchemas: {
  [K in keyof CommandMap]: z.ZodType<CommandMap[K]['return']> | undefined;
} = {
  cmd_ollama_get_models: z.array(OllamaModelSchema),
  cmd_ollama_chat: z.boolean(),
  cmd_ollama_abort_chat: voidSchema,
  cmd_ollama_delete_model: z.boolean(),
  cmd_ollama_pull_model: voidSchema,
  cmd_ollama_check_health: OllamaHealthIpcSchema,
  cmd_ollama_verify_service: z.string(),
  cmd_ollama_generate_title: z.string(),
  cmd_ollama_validate_model: ModelValidationSchema,
  cmd_logs_append: voidSchema,
  cmd_logs_clear: voidSchema,

  // RAG command return schemas
  cmd_rag_add_project: RagProjectSchema,
  cmd_rag_remove_project: z.boolean(),
  cmd_rag_update_project: RagProjectSchema,
  cmd_rag_list_projects: z.array(RagProjectSchema),
  cmd_rag_get_project: RagProjectSchema,
  cmd_rag_index_project: z.boolean(),
  cmd_rag_abort_index: z.boolean(),
  cmd_rag_reindex_project: z.boolean(),
  cmd_rag_get_index_status: IndexStatusSchema,
  cmd_rag_search: z.array(SearchResultSchema),
  cmd_rag_get_file_chunks: z.array(ChunkRecordSchema),
  cmd_cmd_rag_get_project_stats: ProjectStatsSchema,
  cmd_rag_set_embedding_model: z.boolean(),
  cmd_rag_validate_embedding_model: RagModelValidationSchema,
};

/**
 * Checks if the current environment is Tauri.
 */
export const checkIsTauri = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

/**
 * Validates that the provided URL is a safe local-only target.
 * Strips any path, query, or fragment to prevent SSRF via path injection.
 */
export const isValidOllamaUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const { hostname } = parsed;
    const isLocal =
      ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
    const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
    return isLocal || isPrivateIP;
  } catch {
    return false;
  }
};

/**
 * Sanitizes a user-supplied Ollama URL by stripping path, query, and fragment.
 * Returns only scheme + host + port.
 */
export const sanitizeOllamaUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
};

/**
 * Internal helper to perform IPC calls via Tauri core.
 */
async function callInternal<K extends keyof CommandMap>(
  command: K,
  args: CommandMap[K]['args'],
  options?: { quiet?: boolean }
): Promise<CommandMap[K]['return'] | null> {
  if (
    args &&
    'baseUrl' in args &&
    typeof args.baseUrl === 'string' &&
    !isValidOllamaUrl(args.baseUrl)
  ) {
    if (!options?.quiet) {
      toast.error(`Security Block: ${args.baseUrl} is not a valid local address.`);
    }
    return null;
  }

  // Input validation via Zod schemas
  const inputSchema = CommandInputSchemas[command];
  if (inputSchema) {
    const inputResult = inputSchema.safeParse(args);
    if (!inputResult.success) {
      console.error(`[IPC] Input validation failed for "${command}":`, inputResult.error.flatten());
      if (!options?.quiet) {
        toast.error(
          `Invalid request: ${inputResult.error.issues[0]?.message ?? 'validation failed'}`
        );
      }
      return null;
    }
  }

  if (!checkIsTauri()) return null;

  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    const response = await tauriInvoke<ApiResponse<CommandMap[K]['return']>>(command, args);

    const schema = CommandReturnSchemas[command];

    if (response?.success) {
      if (!schema) return (response.data ?? (true as unknown)) as CommandMap[K]['return'];
      const result = schema.safeParse(response.data);
      if (!result.success) {
        const errorMsg = `[IPC] Zod validation failed for "${command}": ${JSON.stringify(result.error.flatten())}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      return result.data;
    }

    if (response?.error) {
      const errorMsg = response.error.message;
      if (!options?.quiet) {
        toast.error(errorMsg);
      }
      throw new Error(errorMsg);
    }
    throw new Error('Unknown error occurred during IPC call');
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}

/**
 * Ollama Engine API
 */
export const ollamaApi = {
  getModels: (baseUrl: string) => callInternal('cmd_ollama_get_models', { baseUrl }),
  deleteModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_delete_model', { baseUrl, name }),
  pullModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_pull_model', { baseUrl, name }),
  checkHealth: (baseUrl: string) =>
    callInternal('cmd_ollama_check_health', { baseUrl }, { quiet: true }),
  verifyService: (baseUrl: string) => callInternal('cmd_ollama_verify_service', { baseUrl }),
  validateModel: (baseUrl: string, modelName: string) =>
    callInternal('cmd_ollama_validate_model', { baseUrl, modelName }),
};

/**
 * Chat & Interaction API
 */
export const chatApi = {
  chat: (args: CommandMap['cmd_ollama_chat']['args']) => callInternal('cmd_ollama_chat', args),
  abort: (requestId: string) => callInternal('cmd_ollama_abort_chat', { requestId }),
};

/**
 * Title Generation API
 */
export const titleApi = {
  generate: (args: CommandMap['cmd_ollama_generate_title']['args']) =>
    callInternal('cmd_ollama_generate_title', args, { quiet: true }),
};

/**
 * Logging & Diagnostics API
 */
export const logApi = {
  append: (entry: string) => callInternal('cmd_logs_append', { entry }),
  clear: () => callInternal('cmd_logs_clear', {}),
};

/**
 * RAG API
 */
export const ragApi = {
  addProject: (args: CommandMap['cmd_rag_add_project']['args']) =>
    callInternal('cmd_rag_add_project', args),
  removeProject: (projectId: string) => callInternal('cmd_rag_remove_project', { projectId }),
  updateProject: (args: CommandMap['cmd_rag_update_project']['args']) =>
    callInternal('cmd_rag_update_project', args),
  listProjects: () => callInternal('cmd_rag_list_projects', {}),
  getProject: (projectId: string) => callInternal('cmd_rag_get_project', { projectId }),
  indexProject: (projectId: string, force?: boolean, baseUrl?: string) =>
    callInternal('cmd_rag_index_project', { projectId, force, baseUrl }),
  abortIndex: (projectId: string) => callInternal('cmd_rag_abort_index', { projectId }),
  reindexProject: (projectId: string, baseUrl?: string) =>
    callInternal('cmd_rag_reindex_project', { projectId, baseUrl }),
  getIndexStatus: (projectId: string) => callInternal('cmd_rag_get_index_status', { projectId }),
  search: (args: CommandMap['cmd_rag_search']['args']) => callInternal('cmd_rag_search', args),
  getFileChunks: (projectId: string, filePath: string) =>
    callInternal('cmd_rag_get_file_chunks', { projectId, filePath }),
  getProjectStats: (projectId: string) =>
    callInternal('cmd_cmd_rag_get_project_stats', { projectId }),
  setEmbeddingModel: (projectId: string, modelName: string) =>
    callInternal('cmd_rag_set_embedding_model', { projectId, modelName }),
  validateEmbeddingModel: (baseUrl: string | undefined, modelName: string) =>
    callInternal('cmd_rag_validate_embedding_model', { baseUrl, modelName }),
};

/**
 * Listen for events from the backend.
 */
export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
  schema?: z.ZodType<T>
): Promise<() => void> {
  if (!checkIsTauri()) return () => {};

  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  return await tauriListen<T>(event, (e) => {
    if (schema) {
      const result = schema.safeParse(e.payload);
      if (result.success) {
        handler(result.data);
      } else {
        console.error(`[IPC] Event "${event}" payload validation failed:`, result.error.flatten());
      }
    } else {
      handler(e.payload);
    }
  });
}

/**
 * Dialog plugin wrappers
 */
export const dialog = {
  ask: async (msg: string, opts: { title?: string; kind?: 'info' | 'warning' | 'error' }) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-dialog')).ask(msg, opts)
      : window.confirm(msg),
  save: async (opts: {
    filters: { name: string; extensions: string[] }[];
    defaultPath?: string;
  }) => (checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).save(opts) : null),
  open: async (opts: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    directory?: boolean;
    defaultPath?: string;
  }): Promise<string | string[] | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).open(opts) : null,
};

/**
 * Opener plugin wrappers
 */
export const opener = {
  openUrl: async (url: string) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-opener')).openUrl(url)
      : window.open(url, '_blank'),
};

/**
 * Store plugin wrappers
 */
export type StoreOptions = Partial<import('@tauri-apps/plugin-store').StoreOptions>;

export const store = {
  load: async (file: string, opts?: StoreOptions) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-store')).load(
          file,
          opts as import('@tauri-apps/plugin-store').StoreOptions
        )
      : null,
};

/**
 * Filesystem plugin wrappers
 */
export const fs = {
  writeTextFile: async (path: string, content: string) =>
    checkIsTauri() && (await import('@tauri-apps/plugin-fs')).writeTextFile(path, content),
  readTextFile: async (path: string): Promise<string | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-fs')).readTextFile(path) : null,
  readFile: async (path: string): Promise<Uint8Array | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-fs')).readFile(path) : null,
};
