'use client';

import { useConversationStore } from './stores/conversation-store';
import { useMessageStore } from './stores/message-store';
import { useUIStore } from './stores/ui-store';
import { useSettingsStore } from './stores/settings-store';
import { useModelStore } from './stores/model-store';
import {
  useStreamingStore,
  selectLiveContent,
  selectIsLiveStreaming,
} from './stores/streaming-store';
import { useRagStore } from './stores/rag-store';
import type {
  Message,
  ChatSettings,
  OllamaModel,
  RagProject,
  SearchResult,
} from '@musaed/contracts';
import type { ConversationState, ConversationMetadata } from './stores/conversation-store';

// ---------------------------------------------------------------------------
// useConversationStore selectors
// ---------------------------------------------------------------------------

export function useConversations(): Record<string, ConversationMetadata> {
  return useConversationStore((s) => s.conversations);
}

export function useConversationIds(): string[] {
  return useConversationStore((s) => s.conversationIds);
}

export function useCurrentConversationId(): string | null {
  return useConversationStore((s) => s.currentConversationId);
}

export function useSearchQuery(): string {
  return useConversationStore((s) => s.searchQuery);
}

// Setter-only hooks (stable references, no re-render risk)
export function useSetConversations(): (conversations: ConversationMetadata[]) => void {
  return useConversationStore((s) => s.setConversations);
}

export function useSetCurrentConversationId(): (id: string | null) => void {
  return useConversationStore((s) => s.setCurrentConversationId);
}

export function useSetSearchQuery(): (searchQuery: string) => void {
  return useConversationStore((s) => s.setSearchQuery);
}

export function useAddConversation(): (conv: ConversationMetadata) => void {
  return useConversationStore((s) => s.addConversation);
}

export function useUpdateConversation(): (
  id: string,
  updates: Partial<ConversationMetadata>
) => void {
  return useConversationStore((s) => s.updateConversation);
}

export function useRemoveConversation(): (id: string) => void {
  return useConversationStore((s) => s.removeConversation);
}

export function useBatchUpdate(): (
  updater: (state: ConversationState) => Partial<ConversationState>
) => void {
  return useConversationStore((s) => s.batchUpdate);
}

// ---------------------------------------------------------------------------
// useMessageStore selectors
// ---------------------------------------------------------------------------

export function useMessages(conversationId: string): Message[] {
  return useMessageStore((s) => s.messages[conversationId] ?? []);
}

export function useAddMessage(): (conversationId: string, message: Message) => void {
  return useMessageStore((s) => s.addMessage);
}

export function useAddMessages(): (conversationId: string, messages: Message[]) => void {
  return useMessageStore((s) => s.addMessages);
}

export function useUpdateLastMessage(): (
  conversationId: string,
  update: Partial<Message>,
  replace?: boolean
) => void {
  return useMessageStore((s) => s.updateLastMessage);
}

export function useClearMessages(): (conversationId: string) => void {
  return useMessageStore((s) => s.clearMessages);
}

// ---------------------------------------------------------------------------
// useUIStore selectors
// ---------------------------------------------------------------------------

export function useIsStreaming(): boolean {
  return useUIStore((s) => s.isStreaming);
}

export function useIsInitialized(): boolean {
  return useUIStore((s) => s.isInitialized);
}

export function useIsHydrated(): boolean {
  return useUIStore((s) => s.isHydrated);
}

export function useIsOllamaConnected(): boolean {
  return useUIStore((s) => s.isOllamaConnected);
}

export function useUIError(): string | null {
  return useUIStore((s) => s.error);
}

export function useIsSettingsOpen(): boolean {
  return useUIStore((s) => s.isSettingsOpen);
}

export function useIsLibraryOpen(): boolean {
  return useUIStore((s) => s.isLibraryOpen);
}

export function useIsInfoOpen(): boolean {
  return useUIStore((s) => s.isInfoOpen);
}

// Setter-only hooks
export function useSetStreaming(): (v: boolean) => void {
  return useUIStore((s) => s.setStreaming);
}

export function useSetInitialized(): (v: boolean) => void {
  return useUIStore((s) => s.setInitialized);
}

export function useSetHydrated(): (v: boolean) => void {
  return useUIStore((s) => s.setHydrated);
}

export function useSetOllamaConnected(): (v: boolean) => void {
  return useUIStore((s) => s.setOllamaConnected);
}

export function useSetUIError(): (v: string | null) => void {
  return useUIStore((s) => s.setError);
}

export function useSetSettingsOpen(): (v: boolean) => void {
  return useUIStore((s) => s.setSettingsOpen);
}

export function useSetLibraryOpen(): (v: boolean) => void {
  return useUIStore((s) => s.setLibraryOpen);
}

export function useSetInfoOpen(): (v: boolean) => void {
  return useUIStore((s) => s.setInfoOpen);
}

// ---------------------------------------------------------------------------
// useSettingsStore selectors
// ---------------------------------------------------------------------------

export function useGlobalSettings(): ChatSettings {
  return useSettingsStore((s) => s.globalSettings);
}

export function useSetGlobalSettings(): (settings: ChatSettings) => void {
  return useSettingsStore((s) => s.setGlobalSettings);
}

// Granular settings sub-selectors – components only re-render when the
// specific field they care about changes.
export function useLanguage(): ChatSettings['language'] {
  return useSettingsStore((s) => s.globalSettings.language);
}

export function useTheme(): ChatSettings['theme'] {
  return useSettingsStore((s) => s.globalSettings.theme);
}

export function useOllamaUrl(): ChatSettings['ollamaUrl'] {
  return useSettingsStore((s) => s.globalSettings.ollamaUrl);
}

export function useEnterToSend(): ChatSettings['enterToSend'] {
  return useSettingsStore((s) => s.globalSettings.enterToSend);
}

export function useChatRetentionDays(): ChatSettings['chatRetentionDays'] {
  return useSettingsStore((s) => s.globalSettings.chatRetentionDays);
}

export function useEnableLatex(): ChatSettings['enableLatex'] {
  return useSettingsStore((s) => s.globalSettings.enableLatex);
}

export function useEnableMermaid(): ChatSettings['enableMermaid'] {
  return useSettingsStore((s) => s.globalSettings.enableMermaid);
}

export function useDensity(): ChatSettings['density'] {
  return useSettingsStore((s) => s.globalSettings.density);
}

export function useSystemPrompt(): ChatSettings['systemPrompt'] {
  return useSettingsStore((s) => s.globalSettings.systemPrompt);
}

export function useTemperature(): ChatSettings['temperature'] {
  return useSettingsStore((s) => s.globalSettings.temperature);
}

export function useTopK(): ChatSettings['top_k'] {
  return useSettingsStore((s) => s.globalSettings.top_k);
}

export function useTopP(): ChatSettings['top_p'] {
  return useSettingsStore((s) => s.globalSettings.top_p);
}

export function useNumPredict(): ChatSettings['num_predict'] {
  return useSettingsStore((s) => s.globalSettings.num_predict);
}

export function useNumCtx(): ChatSettings['num_ctx'] {
  return useSettingsStore((s) => s.globalSettings.num_ctx);
}

export function useStop(): ChatSettings['stop'] {
  return useSettingsStore((s) => s.globalSettings.stop);
}

export function useHasDetectedLanguage(): ChatSettings['hasDetectedLanguage'] {
  return useSettingsStore((s) => s.globalSettings.hasDetectedLanguage);
}

// ---------------------------------------------------------------------------
// useModelStore selectors
// ---------------------------------------------------------------------------

export function useModels(): OllamaModel[] {
  return useModelStore((s) => s.models);
}

export function useSelectedModel(): string {
  return useModelStore((s) => s.selectedModel);
}

export function usePullStatus(): Record<string, { status: string; progress?: number }> {
  return useModelStore((s) => s.pullStatus);
}

// Setter-only hooks
export function useSetModels(): (models: OllamaModel[]) => void {
  return useModelStore((s) => s.setModels);
}

export function useSetSelectedModel(): (model: string) => void {
  return useModelStore((s) => s.setSelectedModel);
}

export function useUpdatePullStatus(): (
  name: string,
  status: { status: string; progress?: number } | null
) => void {
  return useModelStore((s) => s.updatePullStatus);
}

// ---------------------------------------------------------------------------
// useStreamingStore selectors
// ---------------------------------------------------------------------------

export function useLiveContent(conversationId: string): string | null {
  return useStreamingStore(selectLiveContent(conversationId));
}

export function useIsLiveStreaming(conversationId: string): boolean {
  return useStreamingStore(selectIsLiveStreaming(conversationId));
}

export function useActiveStreams(): Record<string, string> {
  return useStreamingStore((s) => s.activeStreams);
}

export function useStartStream(): (conversationId: string, requestId: string) => void {
  return useStreamingStore((s) => s.startStream);
}

export function useStopStream(): (conversationId: string) => void {
  return useStreamingStore((s) => s.stopStream);
}

// ---------------------------------------------------------------------------
// useRagStore selectors
// ---------------------------------------------------------------------------

export function useRagProjects(): Record<string, RagProject> {
  return useRagStore((s) => s.projects);
}

export function useRagProjectIds(): string[] {
  return useRagStore((s) => s.projectIds);
}

export function useActiveRagProjectId(): string | null {
  return useRagStore((s) => s.activeProjectId);
}

export function useActiveRagProject(): RagProject | null {
  return useRagStore((s) => {
    const id = s.activeProjectId;
    return id ? (s.projects[id] ?? null) : null;
  });
}

export function useRagSearchResults(): SearchResult[] {
  return useRagStore((s) => s.searchResults);
}

export function useIsRagSearching(): boolean {
  return useRagStore((s) => s.isSearching);
}

// RAG setter hooks
export function useSetRagProjects(): (projects: RagProject[]) => void {
  return useRagStore((s) => s.setProjects);
}

export function useAddRagProject(): (project: RagProject) => void {
  return useRagStore((s) => s.addProject);
}

export function useRemoveRagProject(): (projectId: string) => void {
  return useRagStore((s) => s.removeProject);
}

export function useUpdateRagProject(): (projectId: string, updates: Partial<RagProject>) => void {
  return useRagStore((s) => s.updateProject);
}

export function useSetActiveRagProjectId(): (id: string | null) => void {
  return useRagStore((s) => s.setActiveProjectId);
}

export function useSetRagIndexProgress(): (
  projectId: string,
  progress: import('@musaed/contracts').IndexProgress | null
) => void {
  return useRagStore((s) => s.setIndexProgress);
}

export function useSetRagSearchResults(): (results: SearchResult[]) => void {
  return useRagStore((s) => s.setSearchResults);
}

export function useSetIsRagSearching(): (isSearching: boolean) => void {
  return useRagStore((s) => s.setIsSearching);
}
