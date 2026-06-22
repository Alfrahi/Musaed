'use client';

import { useState } from 'react';
import { Eraser, MessageSquare, Briefcase } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useSearchQuery } from '@/features/chat/store/conversation-store';
import { useIsHydrated } from '@/store/hooks';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import {
  useConversationStore,
  selectFilteredConversations,
  type ConversationMetadata,
} from '@/features/chat/store/conversation-store';
import { useTranslation } from '@/lib/i18n';
import { ProjectList, AddProjectDialog } from '@/components/Rag';
import { useConversationActions } from '@/features/chat';
import SearchInput from './SearchInput';
import ConversationItem from './ConversationItem';
import SidebarHeader from './SidebarHeader';
import SidebarSkeleton from './SidebarSkeleton';
import SidebarInfo from './SidebarInfo';
import { useSidebarActions } from '../hooks/useSidebarActions';
import { useSidebarGrouping, type SidebarItem } from '../hooks/useSidebarGrouping';

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
    <span className="text-[9px] font-black text-zinc-400 uppercase">{label}</span>
    {showClear && (
      <button
        onClick={onClear}
        className="p-1 text-zinc-400 transition-colors hover:text-red-500"
        title={clearLabel}
      >
        <Eraser size={10} />
      </button>
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

const Sidebar = () => {
  const [activeTab, setActiveTab] = useState<'chats' | 'projects'>('chats');
  const [showAddProject, setShowAddProject] = useState(false);
  const { createNewConversation } = useConversationActions();

  const filteredConversations = useConversationStore(selectFilteredConversations);
  const searchQuery = useSearchQuery();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const isHydrated = useIsHydrated();
  const { t } = useTranslation(language);
  const { handleClearAll } = useSidebarActions();

  const [virtualItems, loadMore] = useSidebarGrouping(
    filteredConversations.reduce((acc, conv) => ({ ...acc, [conv.id]: conv }), {}),
    filteredConversations.map((conv) => conv.id),
    searchQuery
  );

  if (!isHydrated) {
    return (
      <div className="bg-sidebar border-sidebar-border flex h-full w-60 flex-col border-e">
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
    <div className="bg-sidebar border-sidebar-border flex h-full w-60 flex-col border-e select-none">
      <SidebarHeader activeTab={activeTab} onCreateNew={handleCreateNew} />

      <div className="mb-4 flex gap-1 px-4">
        <button
          onClick={() => setActiveTab('chats')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-bold tracking-wider uppercase transition-all ${
            activeTab === 'chats'
              ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
          }`}
        >
          <MessageSquare size={12} />
          {t('sidebar.chats')}
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-bold tracking-wider uppercase transition-all ${
            activeTab === 'projects'
              ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
          }`}
        >
          <Briefcase size={12} />
          {t('sidebar.projects')}
        </button>
      </div>

      {activeTab === 'chats' ? (
        <>
          <SearchInput />
          <div className="flex-1 overflow-hidden">
            <Virtuoso
              style={{ height: '100%' }}
              data={virtualItems}
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
        </>
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
    </div>
  );
};

export default Sidebar;
