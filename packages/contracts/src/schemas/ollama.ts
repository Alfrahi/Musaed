import { z } from 'zod';
import { ChatMessageSchema } from './chat';

// Ollama related schemas
export const OllamaModelDetailsSchema = z.object({
  format: z.string().nullish(),
  family: z.string().nullish(),
  parameterSize: z.string().nullish(),
  quantizationLevel: z.string().nullish(),
});

export const OllamaModelSchema = z.object({
  name: z.string(),
  size: z.number().nullish(),
  digest: z.string().nullish(),
  details: OllamaModelDetailsSchema.nullish(),
});

export const ModelStateSchema = z.object({
  selectedModel: z.string().default(''),
});

export const DEFAULT_MODEL_STATE = {
  selectedModel: '',
};

export const OllamaTokenSchema = z.object({
  model: z.string().nullish(),
  createdAt: z.string().nullish(),
  message: ChatMessageSchema.nullish(),
  done: z.boolean().default(false),
  totalDuration: z.number().nullish(),
  loadDuration: z.number().nullish(),
  promptEvalCount: z.number().nullish(),
  promptEvalDuration: z.number().nullish(),
  evalCount: z.number().nullish(),
  evalDuration: z.number().nullish(),
  requestId: z.string().nullish(),
});

export const PullProgressSchema = z.object({
  status: z.string(),
  digest: z.string().nullish(),
  completed: z.number().nullish(),
  total: z.number().nullish(),
  name: z.string().nullish(),
  percentage: z.number().nullish(),
});

export const PullErrorSchema = z.object({
  name: z.string(),
  error: z.string(),
  duration: z.coerce.number().optional(),
});

export const ModelValidationSchema = z.object({
  isValid: z.boolean(),
  modelName: z.string(),
  details: OllamaModelDetailsSchema.nullish(),
});

export const OllamaHealthIpcSchema = z.object({
  isRunning: z.boolean(),
  version: z.string().nullish(),
  responseTimeMs: z.coerce.number(),
});
