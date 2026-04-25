"use client";

import { Eraser } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useConversations, useConversationIds, useSearchQuery, useIsHydrated, useLanguage } from '@/store/hooks';
import { useTranslation } from '@/lib/i18n';
import SearchInput from './SearchInput';
import ConversationItem from './ConversationItem';
import SidebarHeader from './SidebarHeader';
import SidebarSkeleton from './SidebarSkeleton';
import SidebarInfo from './SidebarInfo';
import { useSidebarActions } from '../hooks/useSidebarActions';
import { useSidebarGrouping } from '../hooks/useSidebarGrouping';

const Sidebar = () => {
  const conversations = useConversations();
  const conversationIds = useConversationIds();
  const searchQuery = useSearchQuery();
  const language = useLanguage();
  const isHydrated = useIsHydrated();
  const { t } = useTranslation(language);
  const { handleClearAll } = useSidebarActions();

  const [virtualItems, loadMore] = useSidebarGrouping(
    conversations,
    conversationIds,
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
          itemContent={(index, item) => {
            if (item.type === 'header') {
              return (
                <div className="ps-3 pe-3 pbs-6 pbe-2 flex items-center justify-between sticky inset-bs-0 bg-sidebar z-10 border-b border-zinc-100 dark:border-zinc-800 mbe-1">
                  <span className="text-[9px] font-black text-zinc-400 uppercase">
                    {item.group === 'search' ? t('sidebar.searchResults') :
                     item.group === 'today' ? t('sidebar.recentChats') :
                     t(`sidebar.${item.group}`)}
                  </span>
                  {item.group === 'today' && !searchQuery && conversationIds.length > 0 && (
                    <button
                      onClick={handleClearAll}
                      className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                      title={t('sidebar.clearAll')}
                    >
                      <Eraser size={10} />
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div className="ps-0 pe-0">
                <ConversationItem conversation={item.data!} />
              </div>
            );
          }}
          endReached={() => {
            if (virtualItems.length < conversationIds.length) {
              loadMore();
            }
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