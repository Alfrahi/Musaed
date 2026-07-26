import { z } from 'zod';
import { ChatSettingsSchema } from './chat';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  images: z.array(z.string()).nullish(),
  timestamp: z.number(),
  model: z.string().nullish(),
  done: z.boolean().nullish(),
  requestId: z.string().nullish(),
  evalCount: z.number().nullish(),
  evalDuration: z.number().nullish(),
  totalDuration: z.number().nullish(),
  ragSources: z
    .array(
      z.object({
        filePath: z.string(),
        startLine: z.number(),
        endLine: z.number(),
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
});

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageSchema),
  model: z.string(),
  settings: ChatSettingsSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
