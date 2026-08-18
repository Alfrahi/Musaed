'use client';

import { Plus } from 'lucide-react';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { isMac } from '@/lib/platform';
import { Button } from '@/components/ui/button';

interface SidebarHeaderProps {
  activeTab: 'chats' | 'projects';
  onCreateNew: () => void;
}

const SidebarHeader = ({ activeTab, onCreateNew }: SidebarHeaderProps) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  return (
    <div className="mbe-3 flex h-12 shrink-0 items-center px-3">
      <Button
        variant="secondary"
        onClick={onCreateNew}
        className="shadow-native text-caption h-8 w-full gap-2 rounded-md ps-3 pe-3 font-bold tracking-normal uppercase"
      >
        <Plus size={14} />
        {activeTab === 'chats' ? t('sidebar.newChat') : t('sidebar.newProject')}
        <span className="font-normal tracking-normal text-white dark:text-zinc-900">
          {isMac() ? '⌘N' : 'Ctrl+N'}
        </span>
      </Button>
    </div>
  );
};

export default SidebarHeader;
