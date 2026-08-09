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
  sidebarCollapsed: z.boolean().default(false),
  closeToTray: z.boolean().default(true),
  showTokenIndicator: z.boolean().default(true),
});

/**
 * The five chat sampling parameters that are tracked per-model. This is the
 * strict subset of {@link ChatSettingsSchema} whose effective values depend on
 * the selected model. `stop` sequences are intentionally excluded — they are
 * workflow-wide, not model-specific.
 */
export const ModelParamsSchema = z.object({
  temperature: z.number(),
  topK: z.number(),
  topP: z.number(),
  numCtx: z.number(),
  numPredict: z.number(),
});
export type ModelParams = z.infer<typeof ModelParamsSchema>;

/**
 * The five per-model sampling parameter keys. Used as the `overrides` enum on
 * {@link ModelParamProfileSchema} to track which fields the user has
 * explicitly set vs. which should fall back to model metadata / defaults.
 */
export const ModelParamKeySchema = z.enum(['temperature', 'topK', 'topP', 'numCtx', 'numPredict']);
export type ModelParamKey = z.infer<typeof ModelParamKeySchema>;

/**
 * Per-model profile for sampling parameters. `overrides` records which keys
 * the user has explicitly changed; keys not present in `overrides` are
 * re-derived from model metadata (for `numCtx`) or {@link DEFAULT_MODEL_PARAMS}
 * on every read. This keeps "default always taken from model metadata unless
 * changed" a live invariant rather than a one-time snapshot.
 */
export const ModelParamProfileSchema = z.object({
  modelName: z.string(),
  params: ModelParamsSchema,
  overrides: z.array(ModelParamKeySchema).default([]),
});
export type ModelParamProfile = z.infer<typeof ModelParamProfileSchema>;
