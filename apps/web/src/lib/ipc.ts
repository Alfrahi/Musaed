// IPC client barrel. The transport plumbing (schema maps, timeout handling,
// latency instrumentation, `callInternal`, event listeners) lives in
// `ipc/transport.ts`; each domain API lives in its own module under `ipc/`.
// This file re-exports everything so existing `@/lib/ipc` imports are
// unchanged.

export * from './ipc/transport';
export { ollamaApi } from './ipc/ollama';
export { chatApi } from './ipc/chat';
export { titleApi } from './ipc/title';
export { logApi } from './ipc/log';
export { traceApi } from './ipc/trace';
export { dialogApi } from './ipc/dialog';
export { openerApi } from './ipc/opener';
export { storeApi } from './ipc/store';
export { fsApi } from './ipc/fs';
export { ragApi } from './ipc/rag';
export { conversationApi } from './ipc/conversation';
export { migrationApi } from './ipc/migration';
export { contextMenuApi } from './ipc/contextMenu';
export { appApi } from './ipc/app';
export { trayApi } from './ipc/tray';
export { menuBarApi } from './ipc/menuBar';
export { metricsApi } from './ipc/metrics';
