'use client';

import { useCallback, useState } from 'react';
import { Eraser, MessageSquare, Briefcase } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useIsHydrated } from '@/store/hooks';
import { useSettingsStore } from '@/store';
import { useSidebarTab, useSetSidebarTab } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { ProjectList, AddProjectDialog } from '@/features/rag';
import {
  useCurrentConversationId,
  useSetCurrentConversationId,
  useSearchQuery,
  useFilteredConversations,
} from '@/store/conversation-store';
import { useConversationActions } from '@/features/conversation';
import { Button } from '@/components/ui/button';
import { ScrollShadow } from '@/components/ui';
import SearchInput from './SearchInput';
import ConversationItem from './ConversationItem';
import SidebarHeader from './SidebarHeader';
import SidebarSkeleton from './SidebarSkeleton';
import SidebarInfo from './SidebarInfo';
import SidebarResizeHandle from './SidebarResizeHandle';
import { useSidebarActions } from '@/features/sidebar/hooks/useSidebarActions';
import { useSidebarGrouping, type SidebarItem } from '@/features/sidebar/hooks/useSidebarGrouping';
import type { ConversationMetadata } from '@/store/conversation-store';

/** Group header (Today, Yesterday, etc.) with optional clear-all button. */
const GroupHeader = ({
  showClear,
  onClear,
  clearLabel,
  label,
}: {
  showClear: boolean;
  onClear: () => void;
  clearLabel: string;
  label: string;
}) => (
  <div className="pbs-6 pbe-2 inset-bs-0 bg-sidebar mbe-1 sticky z-10 flex items-center justify-between border-b border-zinc-100 ps-3 pe-3 dark:border-zinc-800">
    <span className="caption-md font-black text-zinc-400 uppercase">{label}</span>
    {showClear && (
      <Button
        variant="ghost"
        size="icon"
        onClick={onClear}
        className="h-auto w-auto p-1 text-zinc-400 hover:text-red-500"
        title={clearLabel}
      >
        <Eraser size={14} />
      </Button>
    )}
  </div>
);

/** Renders a single virtualized sidebar item (group header or conversation). */
const SidebarItemContent = ({
  item,
  searchQuery,
  filteredConversations,
  handleClearAll,
  t,
}: {
  item: SidebarItem;
  searchQuery: string;
  filteredConversations: ConversationMetadata[];
  handleClearAll: () => void;
  t: (key: string) => string;
}) => {
  if (item.type === 'header') {
    return (
      <GroupHeader
        showClear={item.group === 'today' && !searchQuery && filteredConversations.length > 0}
        onClear={handleClearAll}
        clearLabel={t('sidebar.clearAll')}
        label={
          item.group === 'search'
            ? t('sidebar.searchResults')
            : item.group === 'today'
              ? t('sidebar.recentChats')
              : t(`sidebar.${item.group}`)
        }
      />
    );
  }
  return (
    <div className="ps-0 pe-0">
      <ConversationItem conversation={item.data as ConversationMetadata} />
    </div>
  );
};

/**
 * Pure arrow-key navigation helper for the conversation listbox (WAI-ARIA
 * listbox pattern). Extracted at module scope so the Sidebar component body
 * stays under the project's `max-lines-per-function` lint gate (STANDARDS §11).
 *
 * Uses manual focus management, not `aria-activedescendant`: `ConversationItem`
 * self-focuses via a `useEffect` when it becomes active. The parent listbox is
 * `react-virtuoso` virtualized, so out-of-viewport option ids are unmounted and
 * would violate the `aria-activedescendant` contract. We operate on
 * `filteredConversations` (the canonical full list), not `virtualItems` (which
 * is paginated). Home/End included; PageUp/PageDown left to Virtuoso's scroll.
 */
const moveActiveConversation = (
  e: React.KeyboardEvent<HTMLDivElement>,
  filteredConversations: ConversationMetadata[],
  currentConversationId: string | null,
  setCurrentConversationId: (id: string) => void
): void => {
  const ids = filteredConversations.map((c) => c.id);
  if (ids.length === 0) return;

  const currentIndex = currentConversationId ? ids.indexOf(currentConversationId) : -1;
  let nextIndex = currentIndex;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, ids.length - 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
      break;
    case 'Home':
      e.preventDefault();
      nextIndex = 0;
      break;
    case 'End':
      e.preventDefault();
      nextIndex = ids.length - 1;
      break;
    default:
      return;
  }

  if (nextIndex !== currentIndex && nextIndex >= 0 && nextIndex < ids.length) {
    setCurrentConversationId(ids[nextIndex]);
  }
};

/** Tab buttons for switching between chats and projects views. */
const TabButtons = ({
  activeTab,
  setActiveTab,
  t,
}: {
  activeTab: 'chats' | 'projects';
  setActiveTab: (tab: 'chats' | 'projects') => void;
  t: (key: string) => string;
}) => (
  <div className="mb-4 flex gap-1 px-4">
    <button
      onClick={() => setActiveTab('chats')}
      className={`caption-xs focus-ring duration-fast flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 font-bold tracking-wider uppercase transition-all ${
        activeTab === 'chats'
          ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
      }`}
    >
      <MessageSquare size={14} />
      {t('sidebar.chats')}
    </button>
    <button
      onClick={() => setActiveTab('projects')}
      className={`caption-xs focus-ring duration-fast flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 font-bold tracking-wider uppercase transition-all ${
        activeTab === 'projects'
          ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
      }`}
    >
      <Briefcase size={14} />
      {t('sidebar.projects')}
    </button>
  </div>
);

/** Chats tab content: search input + virtualized conversation listbox. */
const ChatsTabContent = ({
  searchQuery,
  filteredConversations,
  virtualItems,
  loadMore,
  handleListboxKeyDown,
  handleClearAll,
  t,
}: {
  searchQuery: string;
  filteredConversations: ConversationMetadata[];
  virtualItems: SidebarItem[];
  loadMore: () => void;
  handleListboxKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleClearAll: () => void;
  t: (key: string) => string;
}) => {
  const [showShadow, setShowShadow] = useState(false);

  return (
    <>
      <SearchInput />
      <nav aria-label={t('a11y.conversationList')} className="relative flex-1 overflow-hidden">
        <div
          role="listbox"
          aria-label={t('a11y.conversationList')}
          tabIndex={-1}
          onKeyDown={handleListboxKeyDown}
          className="h-full"
        >
          <Virtuoso
            style={{ height: '100%' }}
            data={virtualItems}
            atBottomStateChange={(atBottom) => setShowShadow(!atBottom)}
            itemContent={(_index, item) => (
              <SidebarItemContent
                item={item}
                searchQuery={searchQuery}
                filteredConversations={filteredConversations}
                handleClearAll={handleClearAll}
                t={t}
              />
            )}
            endReached={() => {
              if (virtualItems.length < filteredConversations.length) loadMore();
            }}
            overscan={200}
            increaseViewportBy={200}
          />
        </div>
        <ScrollShadow visible={showShadow} />
      </nav>
    </>
  );
};

const Sidebar = () => {
  const activeTab = useSidebarTab();
  const setActiveTab = useSetSidebarTab();
  const [showAddProject, setShowAddProject] = useState(false);
  const { createNewConversation } = useConversationActions();

  const filteredConversations = useFilteredConversations();
  const searchQuery = useSearchQuery();
  const currentConversationId = useCurrentConversationId();
  const setCurrentConversationId = useSetCurrentConversationId();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const sidebarWidth = useSettingsStore((s) => s.globalSettings.sidebarWidth);
  const isHydrated = useIsHydrated();
  const { t } = useTranslation(language);
  const { handleClearAll } = useSidebarActions();

  const [virtualItems, loadMore] = useSidebarGrouping(
    filteredConversations.reduce(
      (acc, conv) => ({ ...acc, [conv.id]: conv }),
      {} as Record<string, ConversationMetadata>
    ),
    filteredConversations.map((conv: ConversationMetadata) => conv.id),
    searchQuery
  );

  // Arrow-key navigation across the listbox (WAI-ARIA listbox pattern).
  // See `moveActiveConversation` above for the pure helper and rationale
  // (manual focus management, not `aria-activedescendant`).
  const handleListboxKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      moveActiveConversation(
        e,
        filteredConversations,
        currentConversationId,
        setCurrentConversationId
      );
    },
    [filteredConversations, currentConversationId, setCurrentConversationId]
  );

  if (!isHydrated) {
    return (
      <div
        className="bg-sidebar flex h-full flex-col shadow-[1px_0_2px_rgba(0,0,0,0.06)] select-none"
        style={{ width: sidebarWidth }}
      >
        <SidebarSkeleton />
      </div>
    );
  }

  const handleCreateNew = () => {
    if (activeTab === 'chats') {
      createNewConversation();
    } else {
      setShowAddProject(true);
    }
  };

  return (
    <div
      data-testid="sidebar"
      className="bg-sidebar flex h-full flex-col shadow-[1px_0_2px_rgba(0,0,0,0.06)] select-none"
      style={{ width: sidebarWidth }}
    >
      <SidebarHeader activeTab={activeTab} onCreateNew={handleCreateNew} />

      <TabButtons activeTab={activeTab} setActiveTab={setActiveTab} t={t} />

      {activeTab === 'chats' ? (
        <ChatsTabContent
          searchQuery={searchQuery}
          filteredConversations={filteredConversations}
          virtualItems={virtualItems}
          loadMore={loadMore}
          handleListboxKeyDown={handleListboxKeyDown}
          handleClearAll={handleClearAll}
          t={t}
        />
      ) : (
        <div className="flex-1 px-2">
          <ProjectList hideHeaderAction />
        </div>
      )}

      {showAddProject && (
        <AddProjectDialog
          onClose={() => setShowAddProject(false)}
          onAdded={() => setShowAddProject(false)}
        />
      )}

      <SidebarInfo />
      <SidebarResizeHandle />
    </div>
  );
};

export default Sidebar;
