"use client";

import { Eraser } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useConversationStore, useSettingsStore, useUIStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import SearchInput from './SearchInput';
import ConversationItem from './ConversationItem';
import SidebarHeader from './SidebarHeader';
import UserSection from './UserSection';
import SidebarSkeleton from './SidebarSkeleton';
import { useSidebarActions } from '../hooks/useSidebarActions';
import { useSidebarGrouping } from '../hooks/useSidebarGrouping';

const Sidebar = () => {
  const { conversations, conversationIds, searchQuery } = useConversationStore();
  const { globalSettings } = useSettingsStore();
  const { isHydrated } = useUIStore();
  const { t } = useTranslation(globalSettings.language);
  const { handleClearAll } = useSidebarActions();
  
  // FIXED: The hook returns the array directly, no destructuring needed
  const virtualItems = useSidebarGrouping(
    conversations, 
    conversationIds, 
    searchQuery, 
    globalSettings.language
  );

  if (!isHydrated) {
    return (
      <div className="w-64 bg-sidebar border-ie border-sidebar-border flex flex-col h-full">
        <SidebarSkeleton />
      </div>
    );
  }

  return (
    <div className="w-64 bg-sidebar border-ie border-sidebar-border flex flex-col h-full select-none">
      <SidebarHeader />
      <SearchInput />

      <div className="flex-1 overflow-hidden ps-2 pe-2">
        <Virtuoso
          style={{ height: '100%' }}
          data={virtualItems}
          itemContent={(index, item) => {
            if (item.type === 'header') {
              return (
                <div className="ps-3 pe-3 pbs-4 pbe-2 flex items-center justify-between bg-sidebar sticky top-0 z-10">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em]">
                    {item.group === 'search' ? t('sidebar.searchResults') : 
                     item.group === 'today' ? t('sidebar.recentChats') : 
                     t(`sidebar.${item.group}`)}
                  </span>
                  {item.group === 'today' && !searchQuery && conversationIds.length > 0 && (
                    <button 
                      onClick={handleClearAll} 
                      className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-zinc-400 hover:text-red-500 transition-colors"
                      title={t('sidebar.clearAll')}
                    >
                      <Eraser size={12} />
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div className="pbe-1">
                <ConversationItem conversation={item.data!} />
              </div>
            );
          }}
        />

        {virtualItems.length === 0 && (
          <div className="ps-3 pe-3 pbs-8 pbe-8 text-center">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
              {t('sidebar.noConversations')}
            </p>
          </div>
        )}
      </div>

      <UserSection />
    </div>
  );
};

export default Sidebar;