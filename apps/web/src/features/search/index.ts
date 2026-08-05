// Search feature public API.
//
// Provides message-level full-text search across all conversations.
// The search UI is a modal (SearchModal) that queries the Rust backend
// via `conversationApi.searchMessages` and navigates to the selected
// conversation on result click.
export { useMessageSearch } from './hooks/useMessageSearch';
export { default as SearchModal } from './components/SearchModal';
export { default as SearchFeature } from './feature.manifest';
