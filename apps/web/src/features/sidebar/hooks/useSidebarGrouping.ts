"use client";

import { useMemo, useState, useCallback } from 'react';
import { Conversation, Language } from '@musaed/contracts';
import { useTranslation } from '../../../lib/i18n';

export type TimeGroup = 'search' | 'today' | 'yesterday' | 'lastWeek' | 'older';

export interface SidebarItem {
  type: 'header' | 'conversation';
  group?: TimeGroup;
  data?: Conversation;
  id: string;
}

/**
 * Hook to group and filter conversations for display in the sidebar.
 * Supports incremental loading of conversations.
 *
 * @param {Record<string, Conversation>} conversations - Map of conversation IDs to objects.
 * @param {string[]} conversationIds - Ordered list of conversation IDs.
 * @param {string} searchQuery - The user's current search term.
 * @param {Language} language - The active application language.
 * @param {number} [initialLoadCount=50] - Number of conversations to load initially.
 * @param {number} [loadMoreCount=20] - Number of conversations to load when reaching the end.
 * @returns {[SidebarItem[], () => void]} A tuple containing the flattened list of headers and conversation items, and a function to load more conversations.
 */
export function useSidebarGrouping(
  conversations: Record<string, Conversation>,
  conversationIds: string[],
  searchQuery: string,
  language: Language,
  initialLoadCount: number = 50,
  loadMoreCount: number = 20
) {
  const { t } = useTranslation(language);
  const [loadedCount, setLoadedCount] = useState(initialLoadCount);

  // Memoize the filtered conversations to avoid recalculating when only `t` changes.
  const filtered = useMemo(() => {
    const convList = conversationIds.map(id => conversations[id]).filter(Boolean);
    const query = searchQuery.toLowerCase();

    return convList.filter(conv =>
      conv.title.toLowerCase().includes(query) ||
      conv.messages.some(msg => msg.content.toLowerCase().includes(query))
    );
  }, [conversations, conversationIds, searchQuery]);

  // Load more conversations.
  const loadMore = useCallback(() => {
    setLoadedCount(prev => Math.min(prev + loadMoreCount, conversationIds.length));
  }, [conversationIds.length, loadMoreCount]);

  // Get the currently loaded conversations.
  const loadedConversations = useMemo(() => {
    return filtered.slice(0, loadedCount);
  }, [filtered, loadedCount]);

  // Memoize the grouped conversations to avoid recalculating when only `t` changes.
  const groupedItems = useMemo(() => {
    if (searchQuery) {
      return [
        { type: 'header', group: 'search', id: 'header-search' } as SidebarItem,
        ...loadedConversations.map(conv => ({ type: 'conversation', data: conv, id: conv.id } as SidebarItem))
      ];
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - 86400000 * 7;

    const groups: Record<TimeGroup, Conversation[]> = loadedConversations.reduce((acc, conv) => {
      let groupKey: TimeGroup = 'older';
      if (conv.updatedAt >= today) groupKey = 'today';
      else if (conv.updatedAt >= yesterday) groupKey = 'yesterday';
      else if (conv.updatedAt >= lastWeek) groupKey = 'lastWeek';

      acc[groupKey].push(conv);
      return acc;
    }, { today: [], yesterday: [], lastWeek: [], older: [], search: [] } as Record<TimeGroup, Conversation[]>);

    return (['today', 'yesterday', 'lastWeek', 'older'] as TimeGroup[]).flatMap(groupKey => {
      if (groups[groupKey].length === 0) return [];
      return [
        { type: 'header', group: groupKey, id: `header-${groupKey}` } as SidebarItem,
        ...groups[groupKey].map(conv => ({ type: 'conversation', data: conv, id: conv.id } as SidebarItem))
      ];
    });
  }, [loadedConversations, searchQuery]);

  return [groupedItems, loadMore] as const;
}