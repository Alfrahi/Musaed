import { type z } from 'zod';
import { type MessageSchema, type ConversationSchema } from '../schemas/conversation';

export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
