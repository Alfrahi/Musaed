'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eraser,
  MessageSquare,
  Briefcase,
  PanelLeftOpen,
  PanelLeftClose,
  Plus,
} from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useIsHydrated } from '@/store/hooks';
import { useSettingsStore } from '@/store';
import { useSidebarTab, useSetSidebarTab, useShowAddProject, useSetShowAddProject } from '@/store';
import { useSidebarCollapsed, useSetGlobalSettings } from '@/store/settings-store';
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
  <div className="pbs-6 pbe-2 inset-bs-0 bg-sidebar mbe-1 border-be sticky z-10 flex items-center justify-between border-zinc-100 ps-3 pe-3 dark:border-zinc-800">
    <span className="caption-md font-bold text-zinc-400 uppercase">{label}</span>
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
  _currentConversationId,
}: {
  item: SidebarItem;
  searchQuery: string;
  filteredConversations: ConversationMetadata[];
  handleClearAll: () => void;
  t: (key: string) => string;
  _currentConversationId?: string | null;
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
  <div className="mbe-3 flex gap-1 px-3">
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
  currentConversationId,
  t,
}: {
  searchQuery: string;
  filteredConversations: ConversationMetadata[];
  virtualItems: SidebarItem[];
  loadMore: () => void;
  handleListboxKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleClearAll: () => void;
  currentConversationId: string | null;
  t: (key: string) => string;
}) => {
  const [showShadow, setShowShadow] = useState(false);

  return (
    <>
      <SearchInput />
      <nav
        aria-label={t('a11y.conversationList')}
        className="relative h-full flex-1 overflow-hidden"
      >
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
                _currentConversationId={currentConversationId}
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

/** Single circular conversation icon used in the collapsed rail. */
const ConversationIcon = ({
  conversation,
  isActive,
  onSelect,
}: {
  conversation: ConversationMetadata;
  isActive: boolean;
  onSelect: (id: string) => void;
}) => (
  <button
    type="button"
    onClick={() => onSelect(conversation.id)}
    title={conversation.title}
    aria-label={conversation.title}
    aria-current={isActive ? 'true' : undefined}
    className={`caption-sm focus-ring mbe-1.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full font-bold uppercase transition-colors ${
      isActive
        ? 'bg-primary text-primary-fg'
        : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
    }`}
  >
    {conversation.title.charAt(0) || '?'}
  </button>
);

/** Scrollable vertical list of conversation letter-icons. */
const CollapsedConversationList = ({
  conversations,
  currentConversationId,
  setCurrentConversationId,
  ariaLabel,
}: {
  conversations: ConversationMetadata[];
  currentConversationId: string | null;
  setCurrentConversationId: (id: string) => void;
  ariaLabel: string;
}) => (
  <nav
    aria-label={ariaLabel}
    className="flex w-full flex-1 flex-col items-center overflow-y-auto px-0 pb-2"
  >
    {conversations.map((conversation) => (
      <ConversationIcon
        key={conversation.id}
        conversation={conversation}
        isActive={conversation.id === currentConversationId}
        onSelect={setCurrentConversationId}
      />
    ))}
  </nav>
);

/** New-chat icon button for the collapsed rail. */
const CollapsedNewChatButton = ({
  onCreateNew,
  label,
}: {
  onCreateNew: () => void;
  label: string;
}) => (
  <div className="flex h-12 shrink-0 items-center">
    <Button
      variant="ghost"
      size="icon"
      onClick={onCreateNew}
      className="hover:border-sidebar-border h-8 w-8 shrink-0 rounded-md border border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title={label}
      aria-label={label}
    >
      <Plus size={16} />
    </Button>
  </div>
);

/** Expand-sidebar icon button for the collapsed rail. */
const CollapsedExpandButton = ({ onExpand, label }: { onExpand: () => void; label: string }) => (
  <div className="flex h-12 shrink-0 items-center">
    <Button
      variant="ghost"
      size="icon"
      onClick={onExpand}
      className="hover:border-sidebar-border h-8 w-8 shrink-0 rounded-md border border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title={label}
      aria-label={label}
      aria-expanded={false}
    >
      <PanelLeftOpen size={16} />
    </Button>
  </div>
);

/** Collapse-sidebar icon button shown in the expanded sidebar footer. */
const CollapseSidebarButton = ({
  onCollapse,
  label,
}: {
  onCollapse: () => void;
  label: string;
}) => (
  <Button
    variant="ghost"
    size="icon"
    onClick={onCollapse}
    className="caption-md pointer-events-auto h-8 w-8 shrink-0 cursor-pointer rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
    title={label}
    aria-label={label}
  >
    <PanelLeftClose size={16} />
  </Button>
);

/**
 * Thin icon-rail rendered when the sidebar is collapsed. Provides a
 * new-conversation button, a scrollable list of conversation letter-icons,
 * and an expand button at the bottom.
 */
const CollapsedRail = ({
  onExpand,
  onCreateNew,
  conversations,
  currentConversationId,
  setCurrentConversationId,
  expandLabel,
  newChatLabel,
}: {
  onExpand: () => void;
  onCreateNew: () => void;
  conversations: ConversationMetadata[];
  currentConversationId: string | null;
  setCurrentConversationId: (id: string) => void;
  expandLabel: string;
  newChatLabel: string;
}) => (
  <div
    id="sidebar"
    data-testid="sidebar"
    className="border-sidebar-border bg-sidebar flex h-full w-12 flex-col items-center border-e select-none"
  >
    <CollapsedNewChatButton onCreateNew={onCreateNew} label={newChatLabel} />
    <div className="mbe-2 h-px w-6 shrink-0 bg-zinc-200 dark:bg-zinc-800" />
    <CollapsedConversationList
      conversations={conversations}
      currentConversationId={currentConversationId}
      setCurrentConversationId={setCurrentConversationId}
      ariaLabel={expandLabel}
    />
    <CollapsedExpandButton onExpand={onExpand} label={expandLabel} />
  </div>
);

/** Conditionally renders the AddProjectDialog. */
const AddProjectSlot = ({ show, onClose }: { show: boolean; onClose: () => void }) =>
  show ? <AddProjectDialog onClose={onClose} onAdded={onClose} /> : null;

/** Renders the active tab content (chats list or projects). */
const TabContent = ({
  activeTab,
  searchQuery,
  filteredConversations,
  virtualItems,
  loadMore,
  handleListboxKeyDown,
  handleClearAll,
  currentConversationId,
  t,
}: {
  activeTab: 'chats' | 'projects';
  searchQuery: string;
  filteredConversations: ConversationMetadata[];
  virtualItems: SidebarItem[];
  loadMore: () => void;
  handleListboxKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleClearAll: () => void;
  currentConversationId: string | null;
  t: (key: string) => string;
}) =>
  activeTab === 'chats' ? (
    <ChatsTabContent
      searchQuery={searchQuery}
      filteredConversations={filteredConversations}
      virtualItems={virtualItems}
      loadMore={loadMore}
      handleListboxKeyDown={handleListboxKeyDown}
      handleClearAll={handleClearAll}
      currentConversationId={currentConversationId}
      t={t}
    />
  ) : (
    <div className="flex-1 px-2">
      <ProjectList hideHeaderAction />
    </div>
  );

/** Full expanded sidebar content (tabs, list, projects, info, resize). */
const ExpandedSidebar = ({
  activeTab,
  setActiveTab,
  showAddProject,
  setShowAddProject,
  sidebarWidth,
  searchQuery,
  filteredConversations,
  virtualItems,
  loadMore,
  handleListboxKeyDown,
  handleCreateNew,
  handleClearAll,
  onCollapse,
  collapseLabel,
  currentConversationId,
  t,
}: {
  activeTab: 'chats' | 'projects';
  setActiveTab: (tab: 'chats' | 'projects') => void;
  showAddProject: boolean;
  setShowAddProject: (show: boolean) => void;
  sidebarWidth: number;
  searchQuery: string;
  filteredConversations: ConversationMetadata[];
  virtualItems: SidebarItem[];
  loadMore: () => void;
  handleListboxKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleCreateNew: () => void;
  handleClearAll: () => void;
  onCollapse: () => void;
  collapseLabel: string;
  currentConversationId: string | null;
  t: (key: string) => string;
}) => (
  <div
    id="sidebar"
    data-testid="sidebar"
    className="border-sidebar-border bg-sidebar flex h-full flex-col border-e select-none"
    style={{ width: sidebarWidth }}
  >
    <SidebarHeader activeTab={activeTab} onCreateNew={handleCreateNew} />
    <TabButtons activeTab={activeTab} setActiveTab={setActiveTab} t={t} />
    <TabContent
      activeTab={activeTab}
      searchQuery={searchQuery}
      filteredConversations={filteredConversations}
      virtualItems={virtualItems}
      loadMore={loadMore}
      handleListboxKeyDown={handleListboxKeyDown}
      handleClearAll={handleClearAll}
      currentConversationId={currentConversationId}
      t={t}
    />
    <AddProjectSlot show={showAddProject} onClose={() => setShowAddProject(false)} />
    <SidebarInfo
      trailing={<CollapseSidebarButton onCollapse={onCollapse} label={collapseLabel} />}
    />
    <SidebarResizeHandle />
  </div>
);

const Sidebar = () => {
  const activeTab = useSidebarTab();
  const setActiveTab = useSetSidebarTab();
  const showAddProject = useShowAddProject();
  const setShowAddProject = useSetShowAddProject();
  const { createNewConversation } = useConversationActions();

  const filteredConversations = useFilteredConversations();
  const searchQuery = useSearchQuery();
  const currentConversationId = useCurrentConversationId();
  const setCurrentConversationId = useSetCurrentConversationId();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const sidebarWidth = useSettingsStore((s) => s.globalSettings.sidebarWidth);
  const isCollapsed = useSidebarCollapsed();
  const setGlobalSettings = useSetGlobalSettings();
  // Keep a ref to the latest global settings so expandSidebar can spread
  // them without calling getState() (mirrors SidebarResizeHandle pattern).
  const settingsRef = useRef(useSettingsStore.getState().globalSettings);
  useEffect(() => {
    settingsRef.current = useSettingsStore.getState().globalSettings;
  });
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

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => {
      setGlobalSettings({ ...settingsRef.current, sidebarCollapsed: collapsed });
    },
    [setGlobalSettings]
  );

  if (!isHydrated) {
    return (
      <div
        className="border-sidebar-border bg-sidebar flex h-full flex-col border-e select-none"
        style={{ width: sidebarWidth }}
      >
        <SidebarSkeleton />
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <CollapsedRail
        onExpand={() => setSidebarCollapsed(false)}
        onCreateNew={createNewConversation}
        conversations={filteredConversations}
        currentConversationId={currentConversationId}
        setCurrentConversationId={setCurrentConversationId}
        expandLabel={t('a11y.expandSidebar')}
        newChatLabel={t('a11y.newConversationCollapsed')}
      />
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
    <ExpandedSidebar
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      showAddProject={showAddProject}
      setShowAddProject={setShowAddProject}
      sidebarWidth={sidebarWidth}
      searchQuery={searchQuery}
      filteredConversations={filteredConversations}
      virtualItems={virtualItems}
      loadMore={loadMore}
      handleListboxKeyDown={handleListboxKeyDown}
      handleCreateNew={handleCreateNew}
      handleClearAll={handleClearAll}
      onCollapse={() => setSidebarCollapsed(true)}
      collapseLabel={t('a11y.collapseSidebar')}
      currentConversationId={currentConversationId}
      t={t}
    />
  );
};

export default Sidebar;
