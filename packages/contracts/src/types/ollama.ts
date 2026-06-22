import { type z } from 'zod';
import {
  type OllamaModelDetailsSchema,
  type OllamaModelSchema,
  type ModelStateSchema,
  type ModelValidationSchema,
  type OllamaTokenSchema,
  type PullProgressSchema,
  type PullErrorSchema,
  type OllamaHealthIpcSchema,
} from '../schemas/ollama';

export type OllamaModelDetails = z.infer<typeof OllamaModelDetailsSchema>;
export type OllamaModel = z.infer<typeof OllamaModelSchema>;
export type ModelState = z.infer<typeof ModelStateSchema>;
export type ModelValidation = z.infer<typeof ModelValidationSchema>;
export type OllamaToken = z.infer<typeof OllamaTokenSchema>;
export type PullProgress = z.infer<typeof PullProgressSchema>;
export type PullError = z.infer<typeof PullErrorSchema>;
export type OllamaHealthIpc = z.infer<typeof OllamaHealthIpcSchema>;
