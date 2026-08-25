import { type z } from 'zod';
import {
  type OllamaModelDetailsSchema,
  type OllamaModelSchema,
  type ModelStateSchema,
  type ModelValidationSchema,
  type OllamaTokenSchema,
  type PullProgressSchema,
  type PullErrorSchema,
  type OllamaHealthSchema,
} from '../schemas/ollama';
// ModelDefaultParamsSchema lives in schemas/chat beside ModelParamsSchema
// (keeping it there breaks the schemas → types → schemas import cycle).
import { type ModelDefaultParamsSchema } from '../schemas/chat';

export type OllamaModelDetails = z.infer<typeof OllamaModelDetailsSchema>;
export type OllamaModel = z.infer<typeof OllamaModelSchema>;
export type ModelState = z.infer<typeof ModelStateSchema>;
export type ModelDefaultParams = z.infer<typeof ModelDefaultParamsSchema>;
export type ModelValidation = z.infer<typeof ModelValidationSchema>;
export type OllamaToken = z.infer<typeof OllamaTokenSchema>;
export type PullProgress = z.infer<typeof PullProgressSchema>;
export type PullError = z.infer<typeof PullErrorSchema>;
export type OllamaHealth = z.infer<typeof OllamaHealthSchema>;
