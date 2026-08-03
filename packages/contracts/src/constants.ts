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
};
