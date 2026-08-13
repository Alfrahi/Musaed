import { z } from 'zod';
import { ChatSettingsSchema } from './chat';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  images: z.array(z.string()).nullish(),
  timestamp: z.number().int(),
  model: z.string().nullish(),
  done: z.boolean().nullish(),
  requestId: z.string().nullish(),
  evalCount: z.number().int().nullish(),
  promptEvalCount: z.number().int().nullish(),
  completionTokens: z.number().int().nullish(),
  promptTokens: z.number().int().nullish(),
  totalTokens: z.number().int().nullish(),
  evalDuration: z.number().int().nullish(),
  totalDuration: z.number().int().nullish(),
  ragSources: z
    .array(
      z.object({
        filePath: z.string(),
        startLine: z.number().int(),
        endLine: z.number().int(),
        language: z.string().nullish(),
      })
    )
    .nullish(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullish(),
  stopped: z.boolean().nullish(),
});

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageSchema),
  model: z.string(),
  settings: ChatSettingsSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const MessageSearchResultSchema = z.object({
  message: MessageSchema,
  conversationId: z.string(),
  conversationTitle: z.string(),
});

export type MessageSearchResult = z.infer<typeof MessageSearchResultSchema>;
