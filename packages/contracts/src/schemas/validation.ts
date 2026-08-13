import { z } from 'zod';
import { VALIDATION_LIMITS } from '../constants';

// Validation schemas for various inputs
export const ModelNameSchema = z
  .string()
  .min(1)
  .max(VALIDATION_LIMITS.MAX_MODEL_NAME_LEN)
  .regex(/^[a-zA-Z0-9._:/-]+$/);

export const RequestIdSchema = z
  .string()
  .min(1)
  .max(VALIDATION_LIMITS.MAX_REQUEST_ID_LEN)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const LanguageSchema = z.enum(['en', 'ar']);

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant']);

export const IpcChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z
    .string()
    .max(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN, 'Message content exceeds size limit'),
  images: z
    .array(z.string().max(VALIDATION_LIMITS.MAX_IMAGE_B64_LEN, 'Image exceeds size limit'))
    .max(VALIDATION_LIMITS.MAX_IMAGES_PER_MESSAGE, 'Too many images per message')
    .optional(),
});

export const ChatOptionsSchema = z.object({
  temperature: z
    .number()
    .min(VALIDATION_LIMITS.TEMPERATURE_RANGE[0])
    .max(VALIDATION_LIMITS.TEMPERATURE_RANGE[1])
    .finite()
    .optional(),
  topK: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.TOP_K_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_K_RANGE[1])
    .optional(),
  topP: z
    .number()
    .min(VALIDATION_LIMITS.TOP_P_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_P_RANGE[1])
    .finite()
    .optional(),
  numPredict: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_PREDICT_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_PREDICT_RANGE[1])
    .optional(),
  numCtx: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_CTX_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_CTX_RANGE[1])
    .optional(),
  stop: z
    .array(z.string().max(VALIDATION_LIMITS.MAX_STOP_SEQUENCE_LEN))
    .max(VALIDATION_LIMITS.MAX_STOP_SEQUENCES)
    .optional(),
});
export type ChatOptions = z.infer<typeof ChatOptionsSchema>;

// Back-compat alias for callers that imported the historical name.
export const IpcChatOptionsSchema = ChatOptionsSchema;
export type IpcChatOptions = ChatOptions;

export const LogEntrySchema = z
  .string()
  .max(VALIDATION_LIMITS.MAX_LOG_ENTRY_LEN, 'Log entry exceeds size limit');

export const LogClearTokenSchema = z
  .string()
  .min(1)
  .max(VALIDATION_LIMITS.MAX_LOG_CLEAR_TOKEN_LEN, 'Clear token exceeds size limit');

// Structured logging schemas
export const LogLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const TraceStatusSchema = z.enum(['success', 'error', 'cancelled', 'timeout']);
export type TraceStatus = z.infer<typeof TraceStatusSchema>;

export const TraceContextSchema = z.object({
  traceId: z.string().uuid('Invalid traceId format'),
  parentSpanId: z.string().uuid('Invalid spanId format').optional(),
  feature: z
    .string()
    .min(1)
    .max(VALIDATION_LIMITS.MAX_FEATURE_NAME_LEN, 'Feature name exceeds limit'),
  action: z.string().min(1).max(VALIDATION_LIMITS.MAX_ACTION_NAME_LEN, 'Action name exceeds limit'),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

export const TraceEntrySchema = z.object({
  timestamp: z.string().datetime('Invalid timestamp format'),
  traceId: z.string().uuid('Invalid traceId format'),
  spanId: z.string().uuid('Invalid traceId format'),
  parentSpanId: z.string().uuid('Invalid spanId format').optional(),
  feature: z
    .string()
    .min(1)
    .max(VALIDATION_LIMITS.MAX_FEATURE_NAME_LEN, 'Feature name exceeds limit'),
  action: z.string().min(1).max(VALIDATION_LIMITS.MAX_ACTION_NAME_LEN, 'Action name exceeds limit'),
  level: LogLevelSchema,
  status: TraceStatusSchema.optional(),
  latencyMs: z.number().int().min(0).optional(),
  message: z.string().max(VALIDATION_LIMITS.MAX_TRACE_MESSAGE_LEN, 'Message exceeds size limit'),
  source: z.enum(['frontend', 'backend', 'ipc']),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TraceEntry = z.infer<typeof TraceEntrySchema>;

/**
 * Input payload for creating a new trace entry (cmd_trace_append).
 * Mirrors Rust `TraceEntryInput` (src-tauri/src/logging/mod.rs).
 * Unlike `TraceEntry`, this omits `timestamp`/`spanId` because the backend
 * assigns those on receipt.
 */
export const TraceEntryInputSchema = z.object({
  traceId: z.string().uuid('Invalid traceId format'),
  spanId: z.string().uuid('Invalid spanId format').optional(),
  parentSpanId: z.string().uuid('Invalid spanId format').optional(),
  feature: z
    .string()
    .min(1)
    .max(VALIDATION_LIMITS.MAX_FEATURE_NAME_LEN, 'Feature name exceeds limit'),
  action: z.string().min(1).max(VALIDATION_LIMITS.MAX_ACTION_NAME_LEN, 'Action name exceeds limit'),
  level: LogLevelSchema,
  status: TraceStatusSchema.optional(),
  latencyMs: z.number().int().min(0).optional(),
  message: z.string().max(VALIDATION_LIMITS.MAX_TRACE_MESSAGE_LEN, 'Message exceeds size limit'),
  source: z.enum(['frontend', 'backend', 'ipc']),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TraceEntryInput = z.infer<typeof TraceEntryInputSchema>;
