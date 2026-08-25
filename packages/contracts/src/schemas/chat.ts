import { z } from 'zod';
import { VALIDATION_LIMITS } from '../validation-limits';

export const ChatMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  images: z.array(z.string()).optional(),
});

export const ChatSettingsSchema = z.object({
  // ── Deprecated sampling shell (audit F-3) ──────────────────────────────
  // The five fields below are REQUIRED by Rust's `ChatSettings` serde
  // struct (`cmd_conversation_create`) but no longer carry user intent:
  // per-model sampling lives in `model-params-store` profiles. Do not add
  // new readers or writers; persisted values are serde-compatible defaults
  // only. Removal requires a coordinated Rust contract change.
  temperature: z
    .number()
    .min(VALIDATION_LIMITS.TEMPERATURE_RANGE[0])
    .max(VALIDATION_LIMITS.TEMPERATURE_RANGE[1])
    .finite(),
  topK: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.TOP_K_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_K_RANGE[1]),
  topP: z
    .number()
    .min(VALIDATION_LIMITS.TOP_P_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_P_RANGE[1])
    .finite(),
  numPredict: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_PREDICT_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_PREDICT_RANGE[1]),
  numCtx: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_CTX_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_CTX_RANGE[1]),
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
  temperature: z
    .number()
    .min(VALIDATION_LIMITS.TEMPERATURE_RANGE[0])
    .max(VALIDATION_LIMITS.TEMPERATURE_RANGE[1])
    .finite(),
  topK: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.TOP_K_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_K_RANGE[1]),
  topP: z
    .number()
    .min(VALIDATION_LIMITS.TOP_P_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_P_RANGE[1])
    .finite(),
  numCtx: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_CTX_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_CTX_RANGE[1]),
  numPredict: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_PREDICT_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_PREDICT_RANGE[1]),
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

/**
 * Per-model capability facts derived from Ollama's `/api/show`
 * (`cmd_ollama_validate_model`). Purely descriptive — no user intent.
 *
 * Lives beside {@link ModelParamsSchema} (not `types/ollama`) because
 * importing the type from `types/ollama` would close a schemas → types →
 * schemas circular dependency. `ModelDefaultParams` (the z.infer alias)
 * remains exported from `types/ollama`.
 */
export const ModelDefaultParamsSchema = z.object({
  temperature: z.number().finite().nullish(),
  topP: z.number().finite().nullish(),
  topK: z.number().int().nullish(),
  numCtx: z.number().int().nonnegative().nullish(),
  numPredict: z.number().int().nullish(),
});

export interface ModelCapabilities {
  /** From model_info `*.context_length`, already NUM_CTX_RANGE-clamped
   *  Rust-side. `null` = unknown (validation unavailable or failed). */
  contextWindow: number | null;
  /** Modelfile `PARAMETER` defaults. `null` fields = directive absent. */
  modelfileDefaults: z.infer<typeof ModelDefaultParamsSchema> | null;
}

/**
 * The effective sampling parameters for one request, plus diagnostics about
 * whether the stored `numCtx` override survived verbatim. Produced solely by
 * the shared resolver in `apps/web/src/lib/token-budget.ts`.
 */
export interface ResolvedModelParams {
  params: ModelParams;
  /** Stored `numCtx` override verbatim, even when resolution had to clamp it. */
  rawNumCtxOverride: number | null;
  /** True when the stored override exceeded a limit and was reduced. */
  numCtxClamped: boolean;
}
