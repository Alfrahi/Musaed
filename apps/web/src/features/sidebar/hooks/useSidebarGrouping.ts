"use client";

import { useMemo } from 'react';
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
 * 
 * @param {Record<string, Conversation>} conversations - Map of conversation IDs to objects.
 * @param {string[]} conversationIds - Ordered list of conversation IDs.
 * @param {string} searchQuery - The user's current search term.
 * @param {Language} language - The active application language.
 * @returns {SidebarItem[]} A flattened list of headers and conversation items.
 */
export function useSidebarGrouping(
  conversations: Record<string, Conversation>, 
  conversationIds: string[], 
  searchQuery: string,
  language: Language
) {
  const { t } = useTranslation(language);

  return useMemo(() => {
    const convList = conversationIds.map(id => conversations[id]).filter(Boolean);
    const query = searchQuery.toLowerCase();
    
    const filtered = convList.filter(conv => 
      conv.title.toLowerCase().includes(query) ||
      conv.messages.some(msg => msg.content.toLowerCase().includes(query))
    );

    if (searchQuery) {
      return [
        { type: 'header', group: 'search', id: 'header-search' } as SidebarItem,
        ...filtered.map(conv => ({ type: 'conversation', data: conv, id: conv.id } as SidebarItem))
      ];
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - 86400000 * 7;

    const groups: Record<TimeGroup, Conversation[]> = filtered.reduce((acc, conv) => {
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
  }, [conversations, conversationIds, searchQuery, t]);
}