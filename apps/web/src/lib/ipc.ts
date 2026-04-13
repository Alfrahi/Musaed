import { z } from 'zod';
import { ApiResponse, OllamaModel, ChatMessage, ChatSettings } from '@musaed/contracts';
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
  'append_to_log': { args: { entry: string }, return: void };
  'clear_logs': { args: {}, return: void };
}

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

export async function invoke<K extends keyof CommandMap>(
  command: K,
  args: CommandMap[K]['args'] = {} as any,
  schema?: z.ZodType<CommandMap[K]['return']>
): Promise<CommandMap[K]['return'] | null> {
  
  if (args && 'baseUrl' in args && typeof args.baseUrl === 'string' && !isValidOllamaUrl(args.baseUrl)) {
    toast.error(`Security Block: ${args.baseUrl} is not a valid local address.`);
    return null;
  }

  if (!checkIsTauri()) return null;

  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    const response = await tauriInvoke<ApiResponse<any>>(command, args as any);

    if (response?.success) {
      if (!schema) return (response.data ?? true) as any;
      const result = schema.safeParse(response.data);
      if (!result.success) {
        console.error(`[IPC] ${command} Schema Mismatch:`, result.error);
        return null;
      }
      return result.data;
    }

    if (response?.error) toast.error(response.error.message);
    return null;
  } catch (err) { 
    console.error(`[IPC] ${command} Exception:`, err);
    return null; 
  }
}

export async function listen<T>(event: string, handler: (payload: T) => void, schema?: z.ZodType<T>): Promise<() => void> {
  if (!checkIsTauri()) return () => {};
  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  return await tauriListen<any>(event, (e) => {
    if (schema) {
      const result = schema.safeParse(e.payload);
      if (result.success) handler(result.data);
    } else handler(e.payload);
  });
}

/**
 * Consolidating plugin imports for better tree-shaking and local fallbacks
 */
export const dialog = {
  ask: async (msg: string, opts: any) => checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).ask(msg, opts) : window.confirm(msg),
  save: async (opts: any) => checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).save(opts) : null,
};

export const opener = {
  openUrl: async (url: string) => checkIsTauri() ? (await import('@tauri-apps/plugin-opener')).openUrl(url) : window.open(url, '_blank'),
};

export const store = {
  load: async (file: string, opts: any) => checkIsTauri() ? (await import('@tauri-apps/plugin-store')).load(file, opts) : null,
};

export const fs = {
  writeTextFile: async (path: string, content: string) => checkIsTauri() && (await import('@tauri-apps/plugin-fs')).writeTextFile(path, content),
};