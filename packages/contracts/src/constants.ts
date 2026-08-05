export {
  VALIDATION_LIMITS,
  RAG_VALIDATION_LIMITS,
  VALID_ROLES,
  VALID_LANGUAGES,
  MAX_FILE_PATH_LEN,
} from './validation-limits';

// Default chat settings (mirrors previous definition in index.ts)
import { type ChatSettings } from './types/chat';

export const DEFAULT_SETTINGS: ChatSettings = {
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
  numPredict: 2048,
  numCtx: 4096,
  stop: [] as string[],
  systemPrompt: '',
  ollamaUrl: 'http://localhost:11434',
  language: 'en',
  theme: 'system',
  hasDetectedLanguage: false,
  enterToSend: true,
  chatRetentionDays: 0,
  enableLatex: false,
  enableMermaid: true,
  density: 1.0,
  sidebarWidth: 260,
  closeToTray: true,
  showTokenIndicator: true,
};

/**
 * Fallback values for the five per-model sampling parameters. Used by
 * `selectResolvedParams` when a field is not overridden AND (for `numCtx`)
 * model metadata is unavailable. These mirror the sampling subset of
 * {@link DEFAULT_SETTINGS} but are kept as a separate constant because the
 * per-model domain should not depend on the global settings shape.
 */
export const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
  numCtx: 4096,
  numPredict: 2048,
} as const;
