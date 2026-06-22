import { type z } from 'zod';
import { type ChatMessageSchema, type ChatSettingsSchema } from '../schemas/chat';

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;
