import { vi } from 'vitest';

// Mock IPC modules
export const store = {
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
  }),
};

export const logger = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

export const checkIsTauri = vi.fn().mockReturnValue(true);

export const isValidOllamaUrl = vi.fn().mockReturnValue(true);
export const sanitizeOllamaUrl = vi.fn().mockImplementation((url: string) => url);

// Mock chatApi
export const chatApi = {
  chat: vi.fn().mockResolvedValue(true),
  abort: vi.fn().mockResolvedValue(undefined),
};

// Mock titleApi
export const titleApi = {
  generate: vi.fn().mockResolvedValue(''),
};

// Mock ollamaApi
export const ollamaApi = {
  getModels: vi.fn().mockResolvedValue([
    { name: 'llama3', size: 1000, digest: 'abc123' },
    { name: 'mistral', size: 2000, digest: 'def456' },
  ]),
  deleteModel: vi.fn().mockResolvedValue(true),
  pullModel: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi.fn().mockResolvedValue(null),
  verifyService: vi.fn().mockResolvedValue('ok'),
  validateModel: vi.fn().mockResolvedValue(null),
  downloadModel: vi.fn().mockResolvedValue(true),
  abortPull: vi.fn().mockResolvedValue(undefined),
};

// Mock ragApi
export const ragApi = {
  search: vi.fn().mockResolvedValue([]),
  assembleContext: vi
    .fn()
    .mockResolvedValue({ assembled_context: '', citations: [], token_count: 0 }),
  addProject: vi.fn().mockResolvedValue(null),
  removeProject: vi.fn().mockResolvedValue(true),
  updateProject: vi.fn().mockResolvedValue(null),
  listProjects: vi.fn().mockResolvedValue([]),
  getProject: vi.fn().mockResolvedValue(null),
  indexProject: vi.fn().mockResolvedValue(true),
  abortIndex: vi.fn().mockResolvedValue(true),
  reindexProject: vi.fn().mockResolvedValue(true),
  getIndexStatus: vi.fn().mockResolvedValue(null),
  getFileChunks: vi.fn().mockResolvedValue([]),
  getProjectStats: vi.fn().mockResolvedValue(null),
  setEmbeddingModel: vi.fn().mockResolvedValue(true),
  validateEmbeddingModel: vi.fn().mockResolvedValue(null),
  getProjects: vi.fn().mockResolvedValue([]),
  createProject: vi.fn().mockResolvedValue(true),
  deleteProject: vi.fn().mockResolvedValue(true),
};

// Mock logApi
export const logApi = {
  append: vi.fn(),
  clear: vi.fn().mockResolvedValue(null),
};

// Mock traceApi
export const traceApi = {
  append: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue(null),
  complete: vi.fn().mockResolvedValue(undefined),
  getContext: vi.fn().mockResolvedValue(null),
};

// Mock dialogApi
export const dialogApi = {
  ask: vi.fn().mockResolvedValue(true),
};

// Mock exportApi
export const exportApi = {
  exportMarkdown: vi.fn().mockResolvedValue(true),
};

// Mock openerApi
export const openerApi = {
  openUrl: vi.fn().mockResolvedValue(true),
};

// Mock conversationApi
export const conversationApi = {
  listConversations: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn().mockResolvedValue(null),
  createConversation: vi.fn().mockResolvedValue('conv1'),
  appendMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  clearAllConversations: vi.fn().mockResolvedValue(undefined),
  updateConversation: vi.fn().mockResolvedValue(undefined),
};

// Mock dialog
export const dialog = {
  ask: vi.fn().mockResolvedValue(true),
  save: vi.fn().mockResolvedValue(null),
  open: vi.fn().mockResolvedValue(null),
};

// Mock opener
export const opener = {
  openUrl: vi.fn().mockResolvedValue(undefined),
};

// Mock fs
export const fs = {
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(null),
  readFile: vi.fn().mockResolvedValue(null),
};

// Mock store factories
export const createStore = vi.fn().mockReturnValue({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
});
