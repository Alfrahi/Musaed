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

// Mock chatApi
export const chatApi = {
  chat: vi.fn().mockResolvedValue(true),
  abort: vi.fn().mockResolvedValue(undefined),
};

// Mock ollamaApi
export const ollamaApi = {
  getModels: vi.fn().mockResolvedValue([
    { name: 'llama3', size: 1000, digest: 'abc123' },
    { name: 'mistral', size: 2000, digest: 'def456' },
  ]),
  downloadModel: vi.fn().mockResolvedValue(true),
  abortPull: vi.fn().mockResolvedValue(undefined),
};

// Mock ragApi
export const ragApi = {
  search: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  createProject: vi.fn().mockResolvedValue(true),
  deleteProject: vi.fn().mockResolvedValue(true),
};

// Mock store factories
export const createStore = vi.fn().mockReturnValue({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
});
