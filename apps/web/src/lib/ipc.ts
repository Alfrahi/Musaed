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
} from '@musaed/contracts';
import toast from 'react-hot-toast';

export interface CommandMap {
  get_ollama_models: { args: { baseUrl: string }; return: OllamaModel[] };
  chat_with_ollama: {
    args: {
      baseUrl: string;
      model: string;
      messages: ChatMessage[];
      options: Partial<ChatSettings>;
      requestId: string;
    };
    return: boolean;
  };
  abort_chat: { args: { requestId: string }; return: void };
  delete_model: { args: { baseUrl: string; name: string }; return: boolean };
  pull_model: { args: { baseUrl: string; name: string }; return: void };
  check_ollama_health: { args: { baseUrl: string }; return: OllamaHealthIpc };
  verify_ollama_service: { args: { baseUrl: string }; return: string };
  generate_title: {
    args: {
      baseUrl: string;
      model: string;
      userMessage: string;
      assistantMessage: string;
      language: string;
    };
    return: string;
  };
  validate_model: { args: { baseUrl: string; modelName: string }; return: ModelValidation };
  append_to_log: { args: { entry: string }; return: void };
  clear_logs: { args: Record<string, never>; return: void };
}

const voidSchema = z.preprocess((val) => (val === null ? undefined : val), z.void());

/**
 * Input validation schemas for each command's args.
 * Undefined entries mean the args are trivially valid (e.g. empty object).
 */
const CommandInputSchemas: {
  [K in keyof CommandMap]: z.ZodType<CommandMap[K]['args']> | undefined;
} = {
  get_ollama_models: undefined,
  chat_with_ollama: z.object({
    baseUrl: z.string(),
    model: ModelNameSchema,
    messages: z
      .array(IpcChatMessageSchema)
      .max(VALIDATION_LIMITS.MAX_MESSAGES_COUNT, 'Too many messages'),
    options: IpcChatOptionsSchema,
    requestId: RequestIdSchema,
  }),
  abort_chat: z.object({ requestId: RequestIdSchema }),
  delete_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  pull_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  check_ollama_health: undefined,
  verify_ollama_service: undefined,
  generate_title: z.object({
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
  validate_model: z.object({ baseUrl: z.string(), modelName: ModelNameSchema }),
  append_to_log: z.object({ entry: LogEntrySchema }),
  clear_logs: undefined,
};

const CommandReturnSchemas: {
  [K in keyof CommandMap]: z.ZodType<CommandMap[K]['return']> | undefined;
} = {
  get_ollama_models: z.array(OllamaModelSchema),
  chat_with_ollama: z.boolean(),
  abort_chat: voidSchema,
  delete_model: z.boolean(),
  pull_model: voidSchema,
  check_ollama_health: OllamaHealthIpcSchema,
  verify_ollama_service: z.string(),
  generate_title: z.string(),
  validate_model: ModelValidationSchema,
  append_to_log: voidSchema,
  clear_logs: voidSchema,
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
        console.error(`[IPC] Zod validation failed for "${command}":`, result.error.flatten());
        return null;
      }
      return result.data;
    }

    if (response?.error) {
      if (!options?.quiet) {
        toast.error(response.error.message);
      }
    }
    return null;
  } catch (_err) {
    return null;
  }
}

/**
 * Ollama Engine API
 */
export const ollamaApi = {
  getModels: (baseUrl: string) => callInternal('get_ollama_models', { baseUrl }),
  deleteModel: (baseUrl: string, name: string) => callInternal('delete_model', { baseUrl, name }),
  pullModel: (baseUrl: string, name: string) => callInternal('pull_model', { baseUrl, name }),
  checkHealth: (baseUrl: string) =>
    callInternal('check_ollama_health', { baseUrl }, { quiet: true }),
  verifyService: (baseUrl: string) => callInternal('verify_ollama_service', { baseUrl }),
  validateModel: (baseUrl: string, modelName: string) =>
    callInternal('validate_model', { baseUrl, modelName }),
};

/**
 * Chat & Interaction API
 */
export const chatApi = {
  chat: (args: CommandMap['chat_with_ollama']['args']) => callInternal('chat_with_ollama', args),
  abort: (requestId: string) => callInternal('abort_chat', { requestId }),
};

/**
 * Title Generation API
 */
export const titleApi = {
  generate: (args: CommandMap['generate_title']['args']) =>
    callInternal('generate_title', args, { quiet: true }),
};

/**
 * Logging & Diagnostics API
 */
export const logApi = {
  append: (entry: string) => callInternal('append_to_log', { entry }),
  clear: () => callInternal('clear_logs', {}),
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
