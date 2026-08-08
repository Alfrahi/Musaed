'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Settings2, RefreshCw, ChevronDown, Check, Loader2, SlidersHorizontal } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useModelStore, useSettingsStore } from '@/store';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { useModelActions } from '@/features/library/hooks/useModelActions';
import { useModelSelectorKeyboard } from '@/features/library/hooks/useModelSelectorKeyboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ModelParamsPanel from './ModelParamsPanel';

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
      'hover:border-sidebar-border focus-ring text-label duration-normal flex cursor-pointer items-center gap-2 rounded-md border border-transparent py-2 ps-3 pe-3 font-bold text-zinc-500 transition-all hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100',
      isOpen &&
        'border-sidebar-border bg-zinc-100 text-zinc-900 dark:bg-zinc-800/50 dark:text-zinc-100'
    )}
  >
    <Settings2
      size={16}
      className={cn('duration-slow transition-transform', isOpen && 'rotate-90')}
    />
    <span className="max-w-[150px] truncate">{selectedModel || placeholder}</span>
    <ChevronDown
      size={14}
      className={cn('duration-normal transition-transform', isOpen && 'rotate-180')}
    />
  </button>
);

/** Refresh models button. */
const RefreshButton = ({
  onClick,
  isStreaming,
  isFetching,
  title,
}: {
  onClick: () => void;
  isStreaming: boolean;
  isFetching: boolean;
  title: string;
}) => (
  <Button
    variant="ghost"
    size="icon"
    onClick={onClick}
    className="rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-blue-500 dark:hover:bg-zinc-800"
    title={title}
  >
    <RefreshCw size={14} className={cn((isStreaming || isFetching) && 'animate-spin')} />
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
      'text-body duration-normal flex w-full cursor-pointer items-center justify-between py-3 ps-4 pe-4 text-start font-medium transition-colors focus-visible:outline-none',
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
    <p className="text-caption font-bold text-zinc-400 uppercase italic">{message}</p>
  </div>
);

/** Loading state shown while models are being fetched. */
const LoadingModels = ({ message }: { message: string }) => (
  <div
    className="text-body flex items-center justify-center gap-2 py-6 ps-4 pe-4 text-zinc-500 dark:text-zinc-400"
    role="status"
    aria-live="polite"
  >
    <Loader2 size={14} className="animate-spin" />
    <span>{message}</span>
  </div>
);

/** List body — options, loading, or empty state. Extracted to keep
 * `ModelDropdown` under the lint max-lines-per-function budget. */
const ModelListBody = ({
  filtered,
  selectedModel,
  activeIndex,
  optionIdPrefix,
  onSelect,
  onOptionHover,
  isFetching,
  emptyLabel,
  loadingLabel,
}: {
  filtered: { name: string }[];
  selectedModel: string;
  activeIndex: number;
  optionIdPrefix: string;
  onSelect: (name: string) => void;
  onOptionHover: (index: number) => void;
  isFetching: boolean;
  emptyLabel: string;
  loadingLabel: string;
}) => {
  if (filtered.length > 0) {
    return (
      <>
        {filtered.map((m, i) => (
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
        ))}
      </>
    );
  }
  return isFetching ? (
    <LoadingModels message={loadingLabel} />
  ) : (
    <EmptyModels message={emptyLabel} />
  );
};

/** Dropdown panel with model list and optional search filter. */
/**
 * Collapsible "Parameters" section at the bottom of the model dropdown.
 * Extracted from `ModelDropdown` to keep the parent under the lint
 * `max-lines-per-function` cap. Only renders when a model is selected.
 */
const ParamsCollapsible = ({
  selectedModel,
  parametersLabel,
}: {
  selectedModel: string;
  parametersLabel: string;
}) => {
  const [paramsOpen, setParamsOpen] = useState(false);
  if (!selectedModel) return null;
  return (
    <div className="border-sidebar-border border-t">
      <button
        type="button"
        onClick={() => setParamsOpen((v) => !v)}
        className={cn(
          'text-body duration-normal flex w-full cursor-pointer items-center justify-between py-2.5 ps-4 pe-4 font-semibold text-zinc-500 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
        )}
        aria-expanded={paramsOpen}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={14} />
          <span>{parametersLabel}</span>
        </span>
        <ChevronDown
          size={14}
          className={cn('duration-normal transition-transform', paramsOpen && 'rotate-180')}
        />
      </button>
      {paramsOpen && (
        <div className="pbs-2 pbe-2">
          <ModelParamsPanel />
        </div>
      )}
    </div>
  );
};

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
  isFetching,
  loadingLabel,
  parametersLabel,
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
  isFetching: boolean;
  loadingLabel: string;
  parametersLabel: string;
}) => {
  const filtered = searchQuery
    ? models.filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : models;

  return (
    <div
      id={listboxId}
      className="inset-be-full mbe-2 border-sidebar-border shadow-pro animate-in fade-in slide-in-from-bottom-2 duration-normal absolute start-0 z-50 min-w-[280px] border bg-white py-1 transition-all dark:bg-zinc-900"
      role="listbox"
      aria-labelledby={triggerId}
    >
      <div className="border-be border-sidebar-border mbe-1 py-2.5 ps-4 pe-4">
        <span className="caption-md font-bold text-zinc-400 uppercase">{headerLabel}</span>
      </div>
      <div className="border-be border-sidebar-border px-3 pb-2">
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="text-caption w-full border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          aria-label={searchPlaceholder}
        />
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        <ModelListBody
          filtered={filtered}
          selectedModel={selectedModel}
          activeIndex={activeIndex}
          optionIdPrefix={optionIdPrefix}
          onSelect={onSelect}
          onOptionHover={onOptionHover}
          isFetching={isFetching}
          emptyLabel={emptyLabel}
          loadingLabel={loadingLabel}
        />
      </div>

      <ParamsCollapsible selectedModel={selectedModel} parametersLabel={parametersLabel} />
    </div>
  );
};

/** Closes the dropdown when a `mousedown` event fires outside `ref`. */
function useOutsideClick(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, active, onClose]);
}

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
  const { fetchModels, isFetching } = useModelActions();
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

  // Outside-click close (preserved from the previous behavior).
  useOutsideClick(dropdownRef, isOpen, () => setIsOpen(false));

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
          isFetching={isFetching}
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
          isFetching={isFetching}
          loadingLabel={t('library.loadingModels')}
          parametersLabel={t('library.modelParameters')}
        />
      )}
    </div>
  );
};

export default ModelSelector;
