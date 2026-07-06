'use client';

import { useMemo, useState, useCallback } from 'react';
import type { ConversationMetadata } from '@/store/coordination';

export type TimeGroup = 'search' | 'today' | 'yesterday' | 'lastWeek' | 'older';

export interface SidebarItem {
  type: 'header' | 'conversation';
  group?: TimeGroup;
  data?: ConversationMetadata;
  id: string;
}

/**
 * Hook to group and filter conversations for display in the sidebar.
 * Supports incremental loading of conversations.
 *
 * @param {Record<string, ConversationMetadata>} conversations - Map of conversation IDs to objects.
 * @param {string[]} conversationIds - Ordered list of conversation IDs.
 * @param {string} searchQuery - The user's current search term.
 * @param {number} [initialLoadCount=50] - Number of conversations to load initially.
 * @param {number} [loadMoreCount=20] - Number of conversations to load when reaching the end.
 * @returns {[SidebarItem[], () => void]} A tuple containing the flattened list of headers and conversation items, and a function to load more conversations.
 */
export function useSidebarGrouping(
  conversations: Record<string, ConversationMetadata>,
  conversationIds: string[],
  searchQuery: string,
  initialLoadCount: number = 50,
  loadMoreCount: number = 20
) {
  const [loadedCount, setLoadedCount] = useState(initialLoadCount);

  // Memoize the filtered conversations to avoid recalculating when only `t` changes.
  const filtered = useMemo(() => {
    const convList = conversationIds.map((id) => conversations[id]).filter(Boolean);
    const query = searchQuery.toLowerCase();

    // Now we only search in titles because messages are not available in ConversationMetadata
    return convList.filter((conv) => conv.title.toLowerCase().includes(query));
  }, [conversations, conversationIds, searchQuery]);

  // Load more conversations.
  const loadMore = useCallback(() => {
    setLoadedCount((prev) => Math.min(prev + loadMoreCount, conversationIds.length));
  }, [conversationIds.length, loadMoreCount]);

  // Get the currently loaded conversations.
  const loadedConversations = useMemo(() => {
    return filtered.slice(0, loadedCount);
  }, [filtered, loadedCount]);

  // Memoize the grouped conversations to avoid recalculating when only `t` changes.
  const groupedItems = useMemo((): SidebarItem[] => {
    if (searchQuery) {
      return [
        { type: 'header' as const, group: 'search', id: 'header-search' },
        ...loadedConversations.map(
          (conv): SidebarItem => ({ type: 'conversation' as const, data: conv, id: conv.id })
        ),
      ];
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - 86400000 * 7;

    const groups: Record<TimeGroup, ConversationMetadata[]> = loadedConversations.reduce(
      (acc, conv) => {
        let groupKey: TimeGroup = 'older';
        if (conv.updatedAt >= today) groupKey = 'today';
        else if (conv.updatedAt >= yesterday) groupKey = 'yesterday';
        else if (conv.updatedAt >= lastWeek) groupKey = 'lastWeek';

        acc[groupKey].push(conv);
        return acc;
      },
      { today: [], yesterday: [], lastWeek: [], older: [], search: [] } as Record<
        TimeGroup,
        ConversationMetadata[]
      >
    );

    return (['today', 'yesterday', 'lastWeek', 'older'] as TimeGroup[]).flatMap((groupKey) => {
      if (groups[groupKey].length === 0) return [];
      return [
        { type: 'header' as const, group: groupKey, id: `header-${groupKey}` },
        ...groups[groupKey].map(
          (conv): SidebarItem => ({ type: 'conversation' as const, data: conv, id: conv.id })
        ),
      ];
    });
  }, [loadedConversations, searchQuery]);

  return [groupedItems, loadMore] as const;
}
