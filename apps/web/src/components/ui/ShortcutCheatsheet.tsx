'use client';

import { useId } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { ModalLayout } from '@/components/ui';

interface ShortcutCheatsheetProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
}

const ShortcutCheatsheet = ({ isOpen, onClose }: ShortcutCheatsheetProps) => {
  const titleId = useId();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts: ShortcutEntry[] = [
    { keys: [mod, 'N'], description: t('chat.newChat') },
    { keys: [mod, ','], description: t('settings.title') },
    { keys: [mod, 'L'], description: t('common.library') },
    { keys: [mod, 'K'], description: t('a11y.commandPalette') },
    { keys: [mod, '/'], description: t('a11y.shortcutCheatsheet') },
    { keys: ['Esc'], description: t('a11y.closeModal') },
  ];

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} titleId={titleId} maxWidth="max-w-sm">
      <div className="flex flex-col">
        <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 id={titleId} className="text-sm font-semibold">
            {t('a11y.shortcutCheatsheet')}
          </h2>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {shortcuts.map((s) => (
            <div key={s.keys.join('+')} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{s.description}</span>
              <span className="caption-xs flex items-center gap-1 font-mono text-zinc-400">
                {s.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="text-zinc-300">+</span>}
                    <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{k}</kbd>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ModalLayout>
  );
};

export default ShortcutCheatsheet;
