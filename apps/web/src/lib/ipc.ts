import { z } from 'zod';
import {
  ApiResponse,
  OllamaModel,
  ChatMessage,
  ChatSettings,
  OllamaHealthIpc,
  OllamaModelSchema,
  OllamaHealthIpcSchema
} from '@musaed/contracts';
import toast from 'react-hot-toast';

export interface CommandMap {
  'get_ollama_models': { args: { baseUrl: string }, return: OllamaModel[] };
  'chat_with_ollama': {
    args: { baseUrl: string, model: string, messages: ChatMessage[], options: Partial<ChatSettings>, requestId: string },
    return: boolean
  };
  'abort_chat': { args: { requestId: string }, return: void };
  'delete_model': { args: { baseUrl: string, name: string }, return: boolean };
  'pull_model': { args: { baseUrl: string, name: string }, return: void };
  'check_ollama_health': { args: { baseUrl: string }, return: OllamaHealthIpc };
  'append_to_log': { args: { entry: string }, return: void };
  'clear_logs': { args: Record<string, never>, return: void };
}

const voidSchema = z.preprocess((val) => (val === null ? undefined : val), z.void());

const CommandReturnSchemas: { [K in keyof CommandMap]: z.ZodType<CommandMap[K]['return']> | undefined } = {
  'get_ollama_models': z.array(OllamaModelSchema),
  'chat_with_ollama': z.boolean(),
  'abort_chat': voidSchema,
  'delete_model': z.boolean(),
  'pull_model': voidSchema,
  'check_ollama_health': OllamaHealthIpcSchema,
  'append_to_log': voidSchema,
  'clear_logs': voidSchema,
};

/**
 * Checks if the current environment is Tauri.
 */
export const checkIsTauri = (): boolean => 
  typeof window !== 'undefined' && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

/**
 * Validates that the provided URL is a safe local-only target.
 */
export const isValidOllamaUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
    const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
    return isLocal || isPrivateIP;
  } catch { return false; }
};

/**
 * Internal helper to perform IPC calls via Tauri core.
 */
async function callInternal<K extends keyof CommandMap>(
  command: K,
  args: CommandMap[K]['args'],
  options?: { quiet?: boolean }
): Promise<CommandMap[K]['return'] | null> {

  if (args && 'baseUrl' in args && typeof args.baseUrl === 'string' && !isValidOllamaUrl(args.baseUrl)) {
    if (!options?.quiet) {
      toast.error(`Security Block: ${args.baseUrl} is not a valid local address.`);
    }
    return null;
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
  } catch (err) {
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
  checkHealth: (baseUrl: string) => callInternal('check_ollama_health', { baseUrl }, { quiet: true }),
};

/**
 * Chat & Interaction API
 */
export const chatApi = {
  chat: (args: CommandMap['chat_with_ollama']['args']) => callInternal('chat_with_ollama', args),
  abort: (requestId: string) => callInternal('abort_chat', { requestId }),
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
    checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).ask(msg, opts) : window.confirm(msg),
  save: async (opts: { filters: { name: string; extensions: string[] }[]; defaultPath?: string }) =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).save(opts) : null,
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
    checkIsTauri() ? (await import('@tauri-apps/plugin-opener')).openUrl(url) : window.open(url, '_blank'),
};

/**
 * Store plugin wrappers
 */
export const store = {
  load: async (file: string, opts?: unknown) =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-store')).load(file, opts as any) : null,
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