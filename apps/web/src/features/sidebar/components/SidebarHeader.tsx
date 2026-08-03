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
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={onCreateNew}
          className="text-caption shadow-native h-10 flex-1 gap-2 rounded-lg ps-4 pe-4 font-bold tracking-normal uppercase"
        >
          <Plus size={14} />
          {activeTab === 'chats' ? t('sidebar.newChat') : t('sidebar.newProject')}
          <span className="caption-xs font-normal tracking-normal text-zinc-400">
            {isMac() ? '⌘N' : 'Ctrl+N'}
          </span>
        </Button>
      </div>
    </div>
  );
};

export default SidebarHeader;
