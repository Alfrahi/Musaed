'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Settings2, RefreshCw, ChevronDown, Check } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useModelStore, useSettingsStore } from '@/store';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { useModelActions } from '@/features/library/hooks/useModelActions';
import { useModelSelectorKeyboard } from '@/features/library/hooks/useModelSelectorKeyboard';
import { Button } from '@/components/ui/button';

/** Dropdown trigger button with selected model name. */
const SelectorTrigger = ({
  triggerId,
  listboxId,
  selectedModel,
  isOpen,
  activeOptionId,
  placeholder,
  onClick,
  onKeyDown,
  triggerRef,
}: {
  triggerId: string;
  listboxId: string;
  selectedModel: string;
  isOpen: boolean;
  activeOptionId: string | undefined;
  placeholder: string;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) => (
  <button
    ref={triggerRef}
    type="button"
    id={triggerId}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-controls={listboxId}
    aria-activedescendant={activeOptionId}
    onClick={onClick}
    onKeyDown={onKeyDown}
    className={cn(
      'hover:border-sidebar-border focus-visible:ring-offset-background flex items-center gap-2 rounded-md border border-transparent py-2 ps-3 pe-3 text-[13px] font-bold text-zinc-500 transition-all duration-200 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100',
      isOpen &&
        'border-sidebar-border bg-zinc-100 text-zinc-900 dark:bg-zinc-800/50 dark:text-zinc-100'
    )}
  >
    <Settings2
      size={16}
      className={cn('transition-transform duration-300', isOpen && 'rotate-90')}
    />
    <span className="max-w-[150px] truncate">{selectedModel || placeholder}</span>
    <ChevronDown
      size={14}
      className={cn('transition-transform duration-200', isOpen && 'rotate-180')}
    />
  </button>
);

/** Refresh models button. */
const RefreshButton = ({
  onClick,
  isStreaming,
  title,
}: {
  onClick: () => void;
  isStreaming: boolean;
  title: string;
}) => (
  <Button
    variant="ghost"
    size="icon"
    onClick={onClick}
    className="rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-blue-500 dark:hover:bg-zinc-800"
    title={title}
  >
    <RefreshCw size={14} className={cn(isStreaming && 'animate-spin')} />
  </Button>
);

/** Single model option in the dropdown. */
const ModelOption = ({
  id,
  name,
  isSelected,
  isActive,
  index,
  onSelect,
  onOptionHover,
}: {
  id: string;
  name: string;
  isSelected: boolean;
  isActive: boolean;
  index: number;
  onSelect: () => void;
  onOptionHover: (index: number) => void;
}) => (
  // The option uses a `<div>` (not a `<button>`) per the WAI-ARIA combobox
  // pattern: the combobox *trigger* is the only tabbable element; the option
  // is invoked via Enter on the trigger while it is the
  // `aria-activedescendant`. `tabIndex={-1}` lets a pointer-driven screen
  // reader land on it via virtual focus without adding it to the roving Tab
  // sequence.
  <div
    id={id}
    role="option"
    aria-selected={isSelected}
    onClick={onSelect}
    // reason: translate the React MouseEvent into the option index expected by
    // the parent's active-row tracker; passing the event handler through
    // verbatim would assign a MouseEvent to activeIndex.
    onMouseEnter={() => onOptionHover(index)}
    data-active={isActive ? '' : undefined}
    className={cn(
      'flex w-full cursor-pointer items-center justify-between py-3 ps-4 pe-4 text-start text-sm font-medium transition-colors duration-200 focus-visible:outline-none',
      isActive ? 'bg-zinc-50 dark:bg-zinc-800/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
      isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
    )}
  >
    <span className="truncate">{name}</span>
    {isSelected && <Check size={16} className="shrink-0" />}
  </div>
);

/** Empty state when no models are available. */
const EmptyModels = ({ message }: { message: string }) => (
  <div className="py-6 ps-4 pe-4 text-center">
    <p className="text-xs font-bold text-zinc-400 uppercase italic">{message}</p>
  </div>
);

/** Dropdown panel with model list and optional search filter. */
const ModelDropdown = ({
  listboxId,
  triggerId,
  models,
  selectedModel,
  activeIndex,
  optionIdPrefix,
  onSelect,
  onOptionHover,
  headerLabel,
  emptyLabel,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
}: {
  listboxId: string;
  triggerId: string;
  models: { name: string }[];
  selectedModel: string;
  activeIndex: number;
  optionIdPrefix: string;
  onSelect: (name: string) => void;
  onOptionHover: (index: number) => void;
  headerLabel: string;
  emptyLabel: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder: string;
}) => {
  const filtered = searchQuery
    ? models.filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : models;

  return (
    <div
      id={listboxId}
      className="inset-be-full mbe-2 border-sidebar-border shadow-pro animate-in fade-in slide-in-from-bottom-2 absolute start-0 z-50 min-w-[240px] border bg-white py-1 transition-all duration-200 dark:bg-zinc-900"
      role="listbox"
      aria-labelledby={triggerId}
    >
      <div className="border-be border-sidebar-border mbe-1 py-2.5 ps-4 pe-4">
        <span className="caption-md font-black text-zinc-400 uppercase">{headerLabel}</span>
      </div>
      <div className="border-be border-sidebar-border px-3 pb-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full border-none bg-transparent text-xs outline-none placeholder:text-zinc-400"
          aria-label={searchPlaceholder}
        />
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {filtered.length > 0 ? (
          filtered.map((m, i) => (
            <ModelOption
              key={m.name}
              id={`${optionIdPrefix}-${i}`}
              name={m.name}
              isSelected={selectedModel === m.name}
              isActive={i === activeIndex}
              index={i}
              onSelect={() => onSelect(m.name)}
              onOptionHover={onOptionHover}
            />
          ))
        ) : (
          <EmptyModels message={emptyLabel} />
        )}
      </div>
    </div>
  );
};

const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedModel = useModelStore((s) => s.selectedModel);
  const models = useModelStore((s) => s.models);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  const isStreaming = useUIStore((s) => s.isStreaming);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { fetchModels } = useModelActions();
  const { t } = useTranslation(language);

  // reason: `useId()` returns a stable, unique base for the lifetime of this
  // component instance i.e. across opens/closes, so the trigger → listbox
  // `aria-controls` linkage and the `aria-activedescendant` rehydration both
  // refer to consistent DOM ids without manual colliding id management.
  const reactId = useId();
  const triggerId = `model-selector-trigger-${reactId}`;
  const listboxId = `model-selector-listbox-${reactId}`;
  const optionIdPrefix = `model-selector-option-${reactId}`;

  const modelNames = useMemo(() => models.map((m) => m.name), [models]);

  const { handleTriggerKeyDown, typeAheadRef } = useModelSelectorKeyboard({
    modelNames,
    isOpen,
    activeIndex,
    setActiveIndex,
    setIsOpen,
    setSelectedModel,
    triggerRef,
  });

  // When the dropdown opens, default the active index to the currently selected
  // model (or 0 when none is selected). When closed, reset to -1 and clear the
  // type-ahead accumulator so the next open starts fresh.
  useEffect(() => {
    if (isOpen) {
      const selectedIdx = modelNames.indexOf(selectedModel);
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : modelNames.length > 0 ? 0 : -1);
      setSearchQuery('');
    } else {
      setActiveIndex(-1);
      setSearchQuery('');
      typeAheadRef.current = { keys: '', at: 0 };
    }
  }, [isOpen, modelNames, selectedModel, typeAheadRef]);

  // Outside-click close (preserved from the previous behavior — audit F8 task 4).
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activeOptionId =
    isOpen && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined;

  const handleSelect = useCallback(
    (modelName: string) => {
      setSelectedModel(modelName);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [setSelectedModel]
  );

  return (
    <div className="relative font-sans" ref={dropdownRef}>
      <div className="flex items-center gap-1.5">
        <SelectorTrigger
          triggerId={triggerId}
          listboxId={listboxId}
          selectedModel={selectedModel}
          isOpen={isOpen}
          activeOptionId={activeOptionId}
          placeholder={t('library.noModelsFound')}
          onClick={() => setIsOpen((o) => !o)}
          onKeyDown={handleTriggerKeyDown}
          triggerRef={triggerRef}
        />
        <RefreshButton
          onClick={() => fetchModels(true)}
          isStreaming={isStreaming}
          title={t('library.refreshModels')}
        />
      </div>

      {isOpen && (
        <ModelDropdown
          listboxId={listboxId}
          triggerId={triggerId}
          models={models}
          selectedModel={selectedModel}
          activeIndex={activeIndex}
          optionIdPrefix={optionIdPrefix}
          onSelect={handleSelect}
          onOptionHover={setActiveIndex}
          headerLabel={t('a11y.selectModel')}
          emptyLabel={t('library.noModelsFound')}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t('a11y.searchModels')}
        />
      )}
    </div>
  );
};

export default ModelSelector;
