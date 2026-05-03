'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings2, RefreshCw, ChevronDown, Check } from 'lucide-react';
import {
  useSelectedModel,
  useModels,
  useSetSelectedModel,
  useIsStreaming,
  useGlobalSettings,
} from '../../../store/hooks';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { useModelActions } from '../hooks/useModelActions';

/** Dropdown trigger button with selected model name. */
const SelectorTrigger = ({
  selectedModel,
  isOpen,
  onClick,
  placeholder,
}: {
  selectedModel: string;
  isOpen: boolean;
  onClick: () => void;
  placeholder: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'hover:border-sidebar-border flex items-center gap-2 rounded-none border border-transparent py-2 ps-3 pe-3 text-[13px] font-bold text-zinc-500 uppercase transition-all outline-none hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-1 focus-visible:ring-blue-500 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100',
      isOpen &&
        'border-sidebar-border bg-zinc-100 text-zinc-900 dark:bg-zinc-800/50 dark:text-zinc-100'
    )}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
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
  <button
    type="button"
    onClick={onClick}
    className="rounded-none p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-blue-500 dark:hover:bg-zinc-800"
    title={title}
  >
    <RefreshCw size={14} className={cn(isStreaming && 'animate-spin')} />
  </button>
);

/** Single model option in the dropdown. */
const ModelOption = ({
  name,
  isSelected,
  onSelect,
}: {
  name: string;
  isSelected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      'flex w-full items-center justify-between py-3 ps-4 pe-4 text-start text-sm font-medium transition-colors outline-none hover:bg-zinc-50 focus:bg-zinc-50 dark:hover:bg-zinc-800/50 dark:focus:bg-zinc-800/50',
      isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
    )}
    role="option"
    aria-selected={isSelected}
  >
    <span className="truncate">{name}</span>
    {isSelected && <Check size={16} className="shrink-0" />}
  </button>
);

/** Empty state when no models are available. */
const EmptyModels = ({ message }: { message: string }) => (
  <div className="py-6 ps-4 pe-4 text-center">
    <p className="text-xs font-bold text-zinc-400 uppercase italic">{message}</p>
  </div>
);

/** Dropdown panel with model list. */
const ModelDropdown = ({
  models,
  selectedModel,
  onSelect,
  headerLabel,
  emptyLabel,
}: {
  models: { name: string }[];
  selectedModel: string;
  onSelect: (name: string) => void;
  headerLabel: string;
  emptyLabel: string;
}) => (
  <div
    className="inset-be-full mbe-2 border-sidebar-border shadow-pro animate-in fade-in slide-in-from-bottom-2 absolute start-0 z-50 min-w-[240px] border bg-white py-1 duration-200 dark:bg-zinc-900"
    role="listbox"
  >
    <div className="border-be border-sidebar-border mbe-1 py-2.5 ps-4 pe-4">
      <span className="text-[11px] font-black text-zinc-400 uppercase">{headerLabel}</span>
    </div>
    <div className="max-h-[300px] overflow-y-auto">
      {models.length > 0 ? (
        models.map((m) => (
          <ModelOption
            key={m.name}
            name={m.name}
            isSelected={selectedModel === m.name}
            onSelect={() => onSelect(m.name)}
          />
        ))
      ) : (
        <EmptyModels message={emptyLabel} />
      )}
    </div>
  </div>
);

const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedModel = useSelectedModel();
  const models = useModels();
  const setSelectedModel = useSetSelectedModel();
  const isStreaming = useIsStreaming();
  const globalSettings = useGlobalSettings();
  const { fetchModels } = useModelActions();
  const { t } = useTranslation(globalSettings.language);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (modelName: string) => {
    setSelectedModel(modelName);
    setIsOpen(false);
  };

  return (
    <div className="relative font-sans" ref={dropdownRef}>
      <div className="flex items-center gap-1.5">
        <SelectorTrigger
          selectedModel={selectedModel}
          isOpen={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          placeholder={t('library.noModelsFound')}
        />
        <RefreshButton
          onClick={() => fetchModels(true)}
          isStreaming={isStreaming}
          title={t('library.refreshModels')}
        />
      </div>

      {isOpen && (
        <ModelDropdown
          models={models}
          selectedModel={selectedModel}
          onSelect={handleSelect}
          headerLabel={t('a11y.selectModel')}
          emptyLabel={t('library.noModelsFound')}
        />
      )}
    </div>
  );
};

export default ModelSelector;
