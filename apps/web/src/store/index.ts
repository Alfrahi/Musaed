// Shared store layer — global Zustand stores live here (STANDARDS.md §22 "Stores = memory layer").
// A store belongs in src/store/ if more than one feature imports it; keep it in
// features/{x}/store/ only if it is truly feature-private.

// UI ephemeral state
export * from './ui-store';

// Hydration coordination (fires once after all persisted stores have rehydrated)
export * from './coordination';
export * from './batch-manager';

// Conversation domain stores (global because sidebar, settings, layout all import them)
export * from './conversation-store';
export * from './message-store';
export * from './streaming-store';

// Settings domain stores (global because every feature reads settings/model state)
export * from './settings-store';
export * from './model-store';

// RAG domain store (global because conversation, layout, and UI badges consume it)
export * from './rag-store';

// Chat input coordination store (ephemeral — cross-component signal for "Edit prompt")
export * from './chat-input-store';
