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
  'clear_logs': { args: {}, return: void };
}

// Map command return types to their Zod schemas for runtime validation
const CommandReturnSchemas: { [K in keyof CommandMap]: z.ZodType<CommandMap[K]['return']> | undefined } = {
  'get_ollama_models': z.array(OllamaModelSchema),
  'chat_with_ollama': z.boolean(),
  'abort_chat': z.void(),           // ← Fixed
  'delete_model': z.boolean(),
  'pull_model': z.void(),           // ← Fixed
  'check_ollama_health': OllamaHealthIpcSchema,
  'append_to_log': z.void(),
  'clear_logs': z.void(),
};

export const checkIsTauri = () => typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

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
 * Simple IPC invocation without retry loops
 */
export async function invoke<K extends keyof CommandMap>(
  command: K,
  args: CommandMap[K]['args'] = {} as any,
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
    const response = await tauriInvoke<ApiResponse<any>>(command, args as any);

    const schema = CommandReturnSchemas[command];

    if (response?.success) {
      if (!schema) return (response.data ?? true) as any;
      const result = schema.safeParse(response.data);
      if (!result.success) {
        console.error(`[IPC] ${command} Schema Mismatch:`, result.error);
        return null;
      }
      return result.data;
    }

    if (response?.error) {
      console.error(`[IPC] ${command} Error:`, response.error.message);
      if (!options?.quiet) {
        toast.error(response.error.message);
      }
    }
    return null;
  } catch (err) {
    console.error(`[IPC] ${command} Exception:`, err);
    return null;
  }
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
                                schema?: z.ZodType<T>
): Promise<() => void> {
  if (!checkIsTauri()) return () => {};

  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  return await tauriListen<any>(event, (e) => {
    if (schema) {
      const result = schema.safeParse(e.payload);
      if (result.success) {
        handler(result.data);
      } else {
        console.error(`[IPC] Event ${event} Schema Mismatch:`, result.error);
      }
    } else {
      handler(e.payload);
    }
  });
}

/**
 * Plugin API wrappers
 */
export const dialog = {
  ask: async (msg: string, opts: any) =>
  checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).ask(msg, opts) : window.confirm(msg),
  save: async (opts: any) =>
  checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).save(opts) : null,
};

export const opener = {
  openUrl: async (url: string) =>
  checkIsTauri() ? (await import('@tauri-apps/plugin-opener')).openUrl(url) : window.open(url, '_blank'),
};

export const store = {
  load: async (file: string, opts: any) =>
  checkIsTauri() ? (await import('@tauri-apps/plugin-store')).load(file, opts) : null,
};

export const fs = {
  writeTextFile: async (path: string, content: string) =>
  checkIsTauri() && (await import('@tauri-apps/plugin-fs')).writeTextFile(path, content),
};
