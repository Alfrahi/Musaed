/**
 * Pure command-list builders for the CommandPalette.
 *
 * Split out of `components/CommandPalette.tsx` so the builder pipeline can be
 * unit-tested in isolation and so the `CommandPalette` component body stays
 * within the project's `max-lines-per-function` lint budget. No React, no
 * stores — only the i18n callback, the callbacks bag, and the live data
 * (models, conversations, theme, language) needed to assemble the list.
 */

import {
  Settings,
  Plus,
  Library,
  Info,
  Sun,
  Moon,
  Monitor,
  Languages,
  Trash2,
  Download,
  Keyboard,
  MessageSquare,
  Search,
} from 'lucide-react';
import { dialogApi } from '@/lib/ipc';
import type { ConversationMetadata } from '@/store/conversation-store';
import type { Theme } from '@musaed/contracts';

export type CommandCategory =
  | 'commandPalette.categories.navigation'
  | 'commandPalette.categories.model'
  | 'commandPalette.categories.appearance'
  | 'commandPalette.categories.chatActions'
  | 'commandPalette.categories.help';

export interface Command {
  id: string;
  label: string;
  keywords: string[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
  action: () => void;
  category: CommandCategory;
}

/** Ordered list of categories for rendering. */
export const CATEGORY_ORDER: CommandCategory[] = [
  'commandPalette.categories.navigation',
  'commandPalette.categories.model',
  'commandPalette.categories.appearance',
  'commandPalette.categories.chatActions',
  'commandPalette.categories.help',
];

/** Callbacks passed to command builders. */
export interface CommandCallbacks {
  createNewConversation: () => void;
  setLibraryOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setInfoOpen: (v: boolean) => void;
  setCheatsheetOpen: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setCurrentConversationId: (id: string) => void;
  setSelectedModel: (model: string) => void;
  updateGlobalSettings: (update: Record<string, unknown>) => void;
  clearAllConversations: () => void;
  exportCurrentChat: () => void;
}

/** Build navigation commands (new chat, settings, library, info, recent). */
function buildNavCommands(
  t: (key: string) => string,
  cb: CommandCallbacks,
  conversations: Record<string, ConversationMetadata>,
  conversationIds: string[],
  onClose: () => void
): Command[] {
  const nav: CommandCategory = 'commandPalette.categories.navigation';
  const base: Command[] = [
    {
      id: 'nav-new-chat',
      label: t('commandPalette.commands.newChat'),
      keywords: ['new', 'chat', 'conversation', 'start'],
      icon: Plus,
      category: nav,
      action: () => {
        cb.createNewConversation();
        onClose();
      },
    },
    {
      id: 'nav-settings',
      label: t('commandPalette.commands.goToSettings'),
      keywords: ['settings', 'preferences', 'config', 'gear'],
      icon: Settings,
      category: nav,
      action: () => {
        cb.setSettingsOpen(true);
        onClose();
      },
    },
    {
      id: 'nav-library',
      label: t('commandPalette.commands.goToLibrary'),
      keywords: ['library', 'models', 'pull', 'download', 'install'],
      icon: Library,
      category: nav,
      action: () => {
        cb.setLibraryOpen(true);
        onClose();
      },
    },
    {
      id: 'nav-info',
      label: t('commandPalette.commands.goToInfo'),
      keywords: ['about', 'info', 'github', 'privacy'],
      icon: Info,
      category: nav,
      action: () => {
        cb.setInfoOpen(true);
        onClose();
      },
    },
    {
      id: 'nav-search',
      label: t('search.commandLabel'),
      keywords: ['search', 'find', 'messages', 'chats', 'lookup', 'grep'],
      icon: Search,
      category: nav,
      action: () => {
        // Close the palette first so the search modal can take focus without
        // the palette's escape handler racing against it.
        cb.setCommandPaletteOpen(false);
        cb.setSearchOpen(true);
      },
    },
  ];

  const recent = conversationIds
    .slice(0, 10)
    .map((id) => conversations[id])
    .filter(Boolean);

  recent.forEach((conv) => {
    base.push({
      id: `nav-recent-${conv.id}`,
      label: conv.title || t('sidebar.newChat'),
      keywords: ['open', 'conversation', 'chat', conv.title.toLowerCase()],
      icon: MessageSquare,
      category: nav,
      action: () => {
        cb.setCurrentConversationId(conv.id);
        onClose();
      },
    });
  });

  return base;
}

/** Build model-switch commands from the installed models list. */
function buildModelCommands(
  t: (key: string) => string,
  cb: CommandCallbacks,
  models: string[],
  onClose: () => void
): Command[] {
  const model: CommandCategory = 'commandPalette.categories.model';
  return models.map((m) => ({
    id: `model-switch-${m}`,
    label: t('commandPalette.commands.switchModel').replace('{model}', m),
    keywords: ['model', 'switch', 'select', 'use', m],
    icon: Library,
    category: model,
    action: () => {
      cb.setSelectedModel(m);
      onClose();
    },
  }));
}

/** Build appearance commands (theme toggle, language toggle). */
function buildAppearanceCommands(
  t: (key: string) => string,
  cb: CommandCallbacks,
  currentTheme: Theme,
  currentLanguage: string,
  onClose: () => void
): Command[] {
  const appearance: CommandCategory = 'commandPalette.categories.appearance';
  const themeIcon = currentTheme === 'dark' ? Sun : currentTheme === 'light' ? Moon : Monitor;
  return [
    {
      id: 'appearance-toggle-theme',
      label: t('commandPalette.commands.toggleTheme'),
      keywords: ['theme', 'dark', 'light', 'system', 'appearance'],
      icon: themeIcon,
      category: appearance,
      action: () => {
        const next: Theme = currentTheme === 'dark' ? 'light' : 'dark';
        cb.updateGlobalSettings({ theme: next });
        onClose();
      },
    },
    {
      id: 'appearance-toggle-language',
      label: t('commandPalette.commands.toggleLanguage'),
      keywords: ['language', 'arabic', 'english', 'ar', 'en'],
      icon: Languages,
      category: appearance,
      action: () => {
        const next = currentLanguage === 'ar' ? 'en' : 'ar';
        cb.updateGlobalSettings({ language: next });
        onClose();
      },
    },
  ];
}

/** Build chat-action commands (clear all, export). */
function buildChatActionCommands(
  t: (key: string) => string,
  cb: CommandCallbacks,
  onClose: () => void
): Command[] {
  const chatActions: CommandCategory = 'commandPalette.categories.chatActions';
  return [
    {
      id: 'chat-clear-all',
      label: t('commandPalette.commands.clearAllChats'),
      keywords: ['clear', 'delete', 'all', 'chats', 'conversations', 'purge'],
      icon: Trash2,
      category: chatActions,
      action: () => {
        dialogApi
          .ask(t('sidebar.clearAll'), t('sidebar.confirmClearAll'), 'warning')
          .then((confirmed) => {
            if (confirmed) cb.clearAllConversations();
          });
        onClose();
      },
    },
    {
      id: 'chat-export',
      label: t('commandPalette.commands.exportCurrentChat'),
      keywords: ['export', 'markdown', 'save', 'download', 'chat'],
      icon: Download,
      category: chatActions,
      action: () => {
        cb.exportCurrentChat();
        onClose();
      },
    },
  ];
}

/** Build help commands (keyboard shortcuts). */
function buildHelpCommands(
  t: (key: string) => string,
  cb: CommandCallbacks,
  onClose: () => void
): Command[] {
  const help: CommandCategory = 'commandPalette.categories.help';
  return [
    {
      id: 'help-shortcuts',
      label: t('commandPalette.commands.keyboardShortcuts'),
      keywords: ['help', 'keyboard', 'shortcuts', 'cheatsheet', 'hotkeys'],
      icon: Keyboard,
      category: help,
      action: () => {
        cb.setCheatsheetOpen(true);
        onClose();
      },
    },
  ];
}

/** Assemble the full command list from sub-builders. */
export function buildCommands(
  t: (key: string) => string,
  cb: CommandCallbacks,
  models: string[],
  conversations: Record<string, ConversationMetadata>,
  conversationIds: string[],
  currentTheme: Theme,
  currentLanguage: string,
  onClose: () => void
): Command[] {
  return [
    ...buildNavCommands(t, cb, conversations, conversationIds, onClose),
    ...buildModelCommands(t, cb, models, onClose),
    ...buildAppearanceCommands(t, cb, currentTheme, currentLanguage, onClose),
    ...buildChatActionCommands(t, cb, onClose),
    ...buildHelpCommands(t, cb, onClose),
  ];
}
