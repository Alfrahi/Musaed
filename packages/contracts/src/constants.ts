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
  top_k: 40,
  top_p: 0.9,
  num_predict: 2048,
  num_ctx: 4096,
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
};
