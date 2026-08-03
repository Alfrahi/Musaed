import { z } from 'zod';

export const ChatMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  images: z.array(z.string()).optional(),
});

export const ChatSettingsSchema = z.object({
  temperature: z.number(),
  topK: z.number(),
  topP: z.number(),
  numPredict: z.number(),
  numCtx: z.number(),
  stop: z.array(z.string()),
  systemPrompt: z.string(),
  ollamaUrl: z.string(),
  language: z.enum(['en', 'ar']),
  theme: z.enum(['light', 'dark', 'system']),
  hasDetectedLanguage: z.boolean(),
  enterToSend: z.boolean().default(true),
  chatRetentionDays: z.number().default(0),
  enableLatex: z.boolean().default(false),
  enableMermaid: z.boolean().default(true),
  density: z.number().default(1.0),
  sidebarWidth: z.number().min(200).max(400).default(260),
  closeToTray: z.boolean().default(true),
});
