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
  size: z.number().int().nullish(),
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
  totalDuration: z.number().int().nullish(),
  loadDuration: z.number().int().nullish(),
  promptEvalCount: z.number().int().nullish(),
  promptEvalDuration: z.number().int().nullish(),
  evalCount: z.number().int().nullish(),
  evalDuration: z.number().int().nullish(),
  completionTokens: z.number().int().nullish(),
  promptTokens: z.number().int().nullish(),
  totalTokens: z.number().int().nullish(),
  requestId: z.string().nullish(),
});

export const PullProgressSchema = z.object({
  status: z.string(),
  digest: z.string().nullish(),
  completed: z.number().int().nullish(),
  total: z.number().int().nullish(),
  name: z.string().nullish(),
  percentage: z.number().finite().nullish(),
});

export const PullErrorSchema = z.object({
  name: z.string(),
  error: z.string(),
  duration: z.coerce.number().optional(),
});

export const ModelDefaultParamsSchema = z.object({
  temperature: z.number().finite().nullish(),
  topP: z.number().finite().nullish(),
  topK: z.number().int().nullish(),
  numCtx: z.number().int().nonnegative().nullish(),
  numPredict: z.number().int().nullish(),
});

export const ModelValidationSchema = z.object({
  isValid: z.boolean(),
  modelName: z.string(),
  details: OllamaModelDetailsSchema.nullish(),
  contextLength: z.number().int().nullish(),
  defaultParams: ModelDefaultParamsSchema.nullish(),
});

export const OllamaHealthSchema = z.object({
  isRunning: z.boolean(),
  version: z.string().nullish(),
  responseTimeMs: z.coerce.number().int(),
});

// Back-compat alias for callers that imported the historical name.
export const OllamaHealthIpcSchema = OllamaHealthSchema;
