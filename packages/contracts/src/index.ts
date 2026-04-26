"use client";

import { z } from 'zod';

export enum BackendErrorCode {
  NetworkError = 'NETWORK_ERROR',
  OllamaUnavailable = 'OLLAMA_UNAVAILABLE',
  ModelNotFound = 'MODEL_NOT_FOUND',
  InvalidRequest = 'INVALID_REQUEST',
  FileSystemError = 'FILE_SYSTEM_ERROR',
  InternalError = 'INTERNAL_ERROR',
  Aborted = 'ABORTED',
  Unknown = 'UNKNOWN'
}

export const BackendErrorSchema = z.object({
  code: z.string().default(BackendErrorCode.Unknown),
  message: z.string(),
  requestId: z.string().nullish(),
}).transform((data) => ({
  ...data,
  requestId: data.requestId
}));

export type BackendError = z.infer<typeof BackendErrorSchema>;

/**
 * Sanitizes errors by redacting sensitive system paths and URLs while ensuring type safety.
 */
export const sanitizeError = (error: unknown): BackendError => {
  let message = "An unknown error occurred";
  let code = BackendErrorCode.Unknown;
  let requestId: string | undefined;

  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (error !== null && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    
    if (typeof errObj.message === 'string') {
      message = errObj.message;
    }
    
    if (typeof errObj.code === 'string') {
      code = errObj.code as BackendErrorCode;
    }

    const rid = errObj.requestId || errObj.request_id;
    if (typeof rid === 'string') {
      requestId = rid;
    }
  }

  const pathRegex = /([a-zA-Z]:\\(?:[^\\\s]+\\)+|(?:\/[^/\s]+)+\/)/g;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  message = message.replace(pathRegex, '[PATH REDACTED] ');
  
  if (!message.includes('localhost') && !message.includes('127.0.0.1')) {
    message = message.replace(urlRegex, '[URL REDACTED]');
  }

  return { 
    code, 
    message: message.trim(), 
    requestId 
  };
};

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: BackendError;
}

export const OllamaModelDetailsSchema = z.object({
  format: z.string().nullish(),
  family: z.string().nullish(),
  parameter_size: z.string().nullish(),
  quantization_level: z.string().nullish(),
});

export const OllamaModelSchema = z.object({
  name: z.string(),
  size: z.number().nullish(),
  digest: z.string().nullish(),
  details: OllamaModelDetailsSchema.nullish(),
});

export type OllamaModel = z.infer<typeof OllamaModelSchema>;

export const ChatMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  images: z.array(z.string()).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const OllamaTokenSchema = z.object({
  model: z.string().nullish(),
  createdAt: z.string().nullish(),
  message: ChatMessageSchema.nullish(),
  done: z.boolean().default(false),
  total_duration: z.number().nullish(),
  load_duration: z.number().nullish(),
  prompt_eval_count: z.number().nullish(),
  eval_count: z.number().nullish(),
  eval_duration: z.number().nullish(),
  requestId: z.string().nullish(),
  request_id: z.string().nullish(),
}).transform((data) => ({
  ...data,
  requestId: data.requestId || data.request_id
}));

export type OllamaToken = z.infer<typeof OllamaTokenSchema>;

export const PullProgressSchema = z.object({
  status: z.string(),
  completed: z.number().nullish(),
  total: z.number().nullish(),
  name: z.string().nullish(),
});

export type PullProgress = z.infer<typeof PullProgressSchema>;

export const PullErrorSchema = z.object({
  name: z.string(),
  error: z.string(),
  duration: z.coerce.number().optional(),
});

export type PullError = z.infer<typeof PullErrorSchema>;

export const REDACTED_THINKING_TAG_START = '<think>';
export const REDACTED_THINKING_TAG_END = '</think>';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function stripRedactedThinkingBlocks(content: string): string {
  const re = new RegExp(
    `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*?${escapeRegExp(REDACTED_THINKING_TAG_END)}`,
    'gi'
  );
  return content.replace(re, '').trim();
}

/**
 * Strips redacted thinking blocks from content using a Web Worker.
 * Falls back to synchronous implementation if the Web Worker fails.
 * @param content The content to process.
 * @returns A promise that resolves with the processed content.
 */
export async function stripRedactedThinkingBlocksAsync(content: string): Promise<string> {
  try {
    const { stripRedactedThinkingBlocksWorker } = await import('./workerUtils');
    return await stripRedactedThinkingBlocksWorker(content);
  } catch (error) {
    console.warn('Web Worker failed, falling back to synchronous stripRedactedThinkingBlocks:', error);
    return stripRedactedThinkingBlocks(content);
  }
}

export const OllamaHealthIpcSchema = z.object({
  isRunning: z.boolean(),
  version: z.string().nullish(),
  responseTimeMs: z.coerce.number(),
});

export type OllamaHealthIpc = z.infer<typeof OllamaHealthIpcSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  images: z.array(z.string()).optional(),
  timestamp: z.number(),
  model: z.string().optional(),
  done: z.boolean().optional(),
  requestId: z.string().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
  total_duration: z.number().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export type Language = 'en' | 'ar';
export type Theme = 'light' | 'dark' | 'system';

export const ChatSettingsSchema = z.object({
  temperature: z.number(),
  top_k: z.number(),
  top_p: z.number(),
  num_predict: z.number(),
  num_ctx: z.number(),
  stop: z.array(z.string()),
  systemPrompt: z.string(),
  ollamaUrl: z.string(),
  language: z.enum(['en', 'ar']),
  theme: z.enum(['light', 'dark', 'system']),
  hasDetectedLanguage: z.boolean(),
  enterToSend: z.boolean().default(true),
  chatRetentionDays: z.number().default(0),
  enableLatex: z.boolean().default(true),
  enableMermaid: z.boolean().default(true),
  density: z.number().default(1.0),
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageSchema),
  model: z.string(),
  settings: ChatSettingsSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

export const DEFAULT_SETTINGS: ChatSettings = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  num_predict: 2048,
  num_ctx: 4096,
  stop: [],
  systemPrompt: "",
  ollamaUrl: "http://localhost:11434",
  language: 'en',
  theme: 'system',
  hasDetectedLanguage: false,
  enterToSend: true,
  chatRetentionDays: 0,
  enableLatex: true,
  enableMermaid: true,
  density: 1.0,
};