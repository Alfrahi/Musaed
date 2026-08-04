'use client';

import { useSettingsStore } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { useTokenUsage, type TokenUsageInfo } from '../hooks/useTokenUsage';

type SeverityLevel = 'neutral' | 'warning' | 'danger';

const THRESHOLD_WARNING = 70;
const THRESHOLD_DANGER = 90;

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  neutral: 'bg-zinc-400 dark:bg-zinc-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

const SEVERITY_TEXT: Record<SeverityLevel, string> = {
  neutral: 'text-zinc-500 dark:text-zinc-400',
  warning: 'text-amber-600 dark:text-amber-500',
  danger: 'text-red-600 dark:text-red-500',
};

function getSeverity(percentage: number): SeverityLevel {
  if (percentage >= THRESHOLD_DANGER) return 'danger';
  if (percentage >= THRESHOLD_WARNING) return 'warning';
  return 'neutral';
}

function getTooltip(
  severity: SeverityLevel,
  used: number,
  ctx: number,
  t: (key: string, values?: Record<string, string | number | boolean>) => string
): string {
  if (severity === 'danger') return t('chat.tokenContext.nearlyFull', { used, context: ctx });
  if (severity === 'warning') return t('chat.tokenContext.filling', { used, context: ctx });
  return t('chat.tokenContext.usage', { used, context: ctx });
}

const TokenContextBar = () => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const showTokenIndicator = useSettingsStore((s) => s.globalSettings.showTokenIndicator);
  const { t } = useTranslation(language);
  const { usedTokens, contextWindow, percentage, hasData }: TokenUsageInfo = useTokenUsage();

  if (!showTokenIndicator || !hasData) return null;

  const severity = getSeverity(percentage);
  const tooltip = getTooltip(severity, usedTokens, contextWindow, t);

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite" title={tooltip}>
      <span className={`caption-xs font-medium tabular-nums ${SEVERITY_TEXT[severity]}`}>
        {usedTokens.toLocaleString()} / {contextWindow.toLocaleString()}
      </span>
      <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`duration-normal h-full rounded-full transition-all ease-out ${SEVERITY_COLORS[severity]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`caption-xs font-medium tabular-nums ${SEVERITY_TEXT[severity]}`}>
        {percentage}%
      </span>
    </div>
  );
};

export default TokenContextBar;
