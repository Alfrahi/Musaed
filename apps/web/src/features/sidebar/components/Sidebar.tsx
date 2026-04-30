"use client";

import { Eraser } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useSearchQuery, useIsHydrated, useLanguage } from '@/store/hooks';
import { useConversationStore, selectFilteredConversations } from '@/store/stores/conversation-store';
import { useTranslation } from '@/lib/i18n';
import SearchInput from './SearchInput';
import ConversationItem from './ConversationItem';
import SidebarHeader from './SidebarHeader';
import SidebarSkeleton from './SidebarSkeleton';
import SidebarInfo from './SidebarInfo';
import { useSidebarActions } from '../hooks/useSidebarActions';
import { useSidebarGrouping } from '../hooks/useSidebarGrouping';

/** Group header (Today, Yesterday, etc.) with optional clear-all button. */
const GroupHeader = ({
  item, showClear, onClear, clearLabel, label,
}: {
  item: { group?: string };
  showClear: boolean;
  onClear: () => void;
  clearLabel: string;
  label: string;
}) => (
  <div className="ps-3 pe-3 pbs-6 pbe-2 flex items-center justify-between sticky inset-bs-0 bg-sidebar z-10 border-b border-zinc-100 dark:border-zinc-800 mbe-1">
    <span className="text-[9px] font-black text-zinc-400 uppercase">{label}</span>
    {showClear && (
      <button onClick={onClear} className="p-1 text-zinc-400 hover:text-red-500 transition-colors" title={clearLabel}>
        <Eraser size={10} />
      </button>
    )}
  </div>
);

/** Renders a single virtualized sidebar item (group header or conversation). */
const SidebarItemContent = ({ item, searchQuery, filteredConversations, handleClearAll, t }: {
  item: import('../hooks/useSidebarGrouping').SidebarItem;
  searchQuery: string;
  filteredConversations: import('@musaed/contracts').Conversation[];
  handleClearAll: () => void;
  t: (key: string) => string;
}) => {
  if (item.type === 'header') {
    return (
      <GroupHeader
        item={item}
        showClear={item.group === 'today' && !searchQuery && filteredConversations.length > 0}
        onClear={handleClearAll}
        clearLabel={t('sidebar.clearAll')}
        label={
          item.group === 'search' ? t('sidebar.searchResults') :
          item.group === 'today' ? t('sidebar.recentChats') :
          t(`sidebar.${item.group}`)
        }
      />
    );
  }
  return (
    <div className="ps-0 pe-0">
      <ConversationItem conversation={item.data!} />
    </div>
  );
};

const Sidebar = () => {
  const filteredConversations = useConversationStore(selectFilteredConversations);
  const searchQuery = useSearchQuery();
  const language = useLanguage();
  const isHydrated = useIsHydrated();
  const { t } = useTranslation(language);
  const { handleClearAll } = useSidebarActions();

  const [virtualItems, loadMore] = useSidebarGrouping(
    filteredConversations.reduce((acc, conv) => ({ ...acc, [conv.id]: conv }), {}),
    filteredConversations.map(conv => conv.id),
    searchQuery,
    language
  );

  if (!isHydrated) {
    return (
      <div className="w-60 bg-sidebar flex flex-col h-full border-e border-sidebar-border">
        <SidebarSkeleton />
      </div>
    );
  }

  return (
    <div className="w-60 bg-sidebar flex flex-col h-full select-none border-e border-sidebar-border">
      <SidebarHeader />
      <SearchInput />

      <div className="flex-1 overflow-hidden">
        <Virtuoso
          style={{ height: '100%' }}
          data={virtualItems}
          itemContent={(_index, item) => (
            <SidebarItemContent
              item={item} searchQuery={searchQuery} filteredConversations={filteredConversations}
              handleClearAll={handleClearAll} t={t}
            />
          )}
          endReached={() => {
            if (virtualItems.length < filteredConversations.length) loadMore();
          }}
          overscan={200}
          increaseViewportBy={200}
        />
      </div>

      <SidebarInfo />
    </div>
  );
};

export default Sidebar;
