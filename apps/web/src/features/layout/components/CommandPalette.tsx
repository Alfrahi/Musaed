'use client';

import { useState, useId, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { ModalLayout } from '@/components/ui';
import { useCommands } from '../hooks/useCommands';
import { CATEGORY_ORDER, type Command, type CommandCategory } from '../utils/build-commands';

/**
 * CommandPalette — app-wide ⌘K palette.
 *
 * Lives in the `layout` feature because it is a composition-root component
 * that orchestrates multiple features (conversation, library, settings).
 * `layout` is the composition root (STANDARDS.md §3) and is exempt from
 * cross-feature import rules, so it may freely import from `@/features/*`.
 *
 * The command list is assembled by `useCommands` (hooks/useCommands.ts) from
 * live store state; the pure builder pipeline lives in
 * `utils/build-commands.ts`. This file is presentational only.
 */

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
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
      className={`text-body flex w-full items-center gap-3 px-4 py-2.5 transition-colors ${
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
      className="text-body w-full border-none bg-transparent outline-none placeholder:text-zinc-400"
      aria-label={placeholder}
    />
    <span className="caption-xs rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-400 dark:bg-zinc-800">
      ESC
    </span>
  </div>
);

/** Category section header inside the listbox. */
const CategoryHeader = ({ label }: { label: string }) => (
  <div className="caption-xs px-4 pt-3 pb-1 font-semibold tracking-normal text-zinc-400">
    {label}
  </div>
);

/** Renders the filtered command list or empty state. */
const CommandList = ({
  filtered,
  activeIndex,
  onHover,
  emptyLabel,
  t,
}: {
  filtered: Command[];
  activeIndex: number;
  onHover: (i: number) => void;
  emptyLabel: string;
  t: (key: string) => string;
}) => {
  if (filtered.length === 0) {
    return (
      <div role="listbox" className="max-h-80 overflow-y-auto py-2">
        <p className="text-caption px-4 py-6 text-center text-zinc-400">{emptyLabel}</p>
      </div>
    );
  }

  // Group by category in display order, only show categories that have matches.
  const groups: { category: CommandCategory; items: { cmd: Command; index: number }[] }[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items: { cmd: Command; index: number }[] = [];
    filtered.forEach((cmd, i) => {
      if (cmd.category === cat) items.push({ cmd, index: i });
    });
    if (items.length > 0) groups.push({ category: cat, items });
  }

  return (
    <div role="listbox" className="max-h-80 overflow-y-auto py-2">
      {groups.map((group) => (
        <div key={group.category}>
          <CategoryHeader label={t(group.category)} />
          {group.items.map(({ cmd, index }) => (
            <CommandOption
              key={cmd.id}
              cmd={cmd}
              isActive={index === activeIndex}
              onSelect={cmd.action}
              onHover={() => onHover(index)}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const commands = useCommands(onClose);

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
          placeholder={t('commandPalette.placeholder')}
          inputRef={inputRef}
        />
        <CommandList
          filtered={filtered}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          emptyLabel={t('commandPalette.noResults')}
          t={t}
        />
      </div>
    </ModalLayout>
  );
};

export default CommandPalette;
