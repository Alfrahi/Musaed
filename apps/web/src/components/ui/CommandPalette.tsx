'use client';

import { useState, useId, useEffect, useRef, useCallback } from 'react';
import { Search, MessageSquare, Settings, Plus } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { useConversationActions } from '@/features/conversation';
import { useSetLibraryOpen, useSetSettingsOpen } from '@/store/hooks';
import { ModalLayout } from '@/components/ui';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Command {
  id: string;
  label: string;
  keywords: string[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
  action: () => void;
}

/** Single command option in the palette listbox. */
const CommandOption = ({
  cmd,
  isActive,
  onSelect,
  onHover,
}: {
  cmd: Command;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const Icon = cmd.icon;
  return (
    // eslint-disable-next-line musaed-buttons/prefer-button-primitive -- role="option" listbox item, not an action button
    <button
      role="option"
      aria-selected={isActive}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        isActive
          ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
      }`}
    >
      <Icon size={16} className="shrink-0" />
      <span>{cmd.label}</span>
    </button>
  );
};

/** Search input for the command palette. */
const PaletteSearch = ({
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) => (
  <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
    <Search size={18} className="shrink-0 text-zinc-400" />
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className="w-full border-none bg-transparent text-sm outline-none placeholder:text-zinc-400"
      aria-label={placeholder}
    />
    <span className="caption-xs rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-400 dark:bg-zinc-800">
      ESC
    </span>
  </div>
);

/** Build the command list from translated labels and action closures. */
function buildCommands(
  t: (key: string) => string,
  createNewConversation: () => void,
  setLibraryOpen: (v: boolean) => void,
  setSettingsOpen: (v: boolean) => void,
  onClose: () => void
): Command[] {
  return [
    {
      id: 'new-chat',
      label: t('chat.newChat'),
      keywords: ['new', 'chat', 'conversation'],
      icon: Plus,
      action: () => {
        createNewConversation();
        onClose();
      },
    },
    {
      id: 'library',
      label: t('common.library'),
      keywords: ['library', 'models', 'pull', 'download'],
      icon: MessageSquare,
      action: () => {
        setLibraryOpen(true);
        onClose();
      },
    },
    {
      id: 'settings',
      label: t('settings.title'),
      keywords: ['settings', 'preferences', 'config'],
      icon: Settings,
      action: () => {
        setSettingsOpen(true);
        onClose();
      },
    },
  ];
}

/** Renders the filtered command list or empty state. */
const CommandList = ({
  filtered,
  activeIndex,
  onHover,
  emptyLabel,
}: {
  filtered: Command[];
  activeIndex: number;
  onHover: (i: number) => void;
  emptyLabel: string;
}) => (
  <div role="listbox" className="max-h-64 overflow-y-auto py-2">
    {filtered.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-zinc-400">{emptyLabel}</p>
    ) : (
      filtered.map((cmd, i) => (
        <CommandOption
          key={cmd.id}
          cmd={cmd}
          isActive={i === activeIndex}
          onSelect={cmd.action}
          onHover={() => onHover(i)}
        />
      ))
    )}
  </div>
);

const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const { createNewConversation } = useConversationActions();
  const setLibraryOpen = useSetLibraryOpen();
  const setSettingsOpen = useSetSettingsOpen();

  const commands = buildCommands(
    t,
    createNewConversation,
    setLibraryOpen,
    setSettingsOpen,
    onClose
  );

  const filtered = query
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.keywords.some((k) => k.toLowerCase().includes(query.toLowerCase()))
      )
    : commands;

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].action();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [filtered, activeIndex, onClose]
  );

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} titleId={titleId} maxWidth="max-w-lg">
      <div className="flex flex-col" role="combobox" aria-expanded={isOpen} aria-haspopup="listbox">
        <PaletteSearch
          value={query}
          onChange={(v) => {
            setQuery(v);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('a11y.searchModels')}
          inputRef={inputRef}
        />
        <CommandList
          filtered={filtered}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          emptyLabel={t('library.noModelsFound')}
        />
      </div>
    </ModalLayout>
  );
};

export default CommandPalette;
