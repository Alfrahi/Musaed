'use client';

import { FileText, Code, FileCode, File } from 'lucide-react';
import { useRagSearchResults } from '../store/rag-store';
import { useSettingsStore } from '../../settings/store/settings-store';
import { useTranslation } from '../../../lib/i18n';
import type { SearchResult } from '@musaed/contracts';

const chunkTypeIcon = (type: string) => {
  switch (type) {
    case 'code':
      return <Code className="h-3 w-3" />;
    case 'markdown':
      return <FileText className="h-3 w-3" />;
    case 'config':
      return <FileCode className="h-3 w-3" />;
    default:
      return <File className="h-3 w-3" />;
  }
};

export const SearchResults = () => {
  const results = useRagSearchResults();
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const { t } = useTranslation(globalSettings.language);

  if (results.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        {t('rag.searchResultCount', { count: results.length })}
      </p>
      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {results.map((result, i) => (
          <SearchResultCard key={`${result.chunkId}-${i}`} result={result} rank={i + 1} />
        ))}
      </div>
    </div>
  );
};

const SearchResultCard = ({ result, rank }: { result: SearchResult; rank: number }) => {
  return (
    <div className="border-border space-y-1 rounded-md border p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">#{rank}</span>
        {chunkTypeIcon(result.chunkType)}
        <span className="truncate font-medium">{result.filePath}</span>
        <span className="text-muted-foreground">
          L{result.startLine}-{result.endLine}
        </span>
        {result.language && (
          <span className="text-muted-foreground bg-accent/50 rounded px-1 text-[10px]">
            {result.language}
          </span>
        )}
        <span className="text-muted-foreground ms-auto">{(result.score * 100).toFixed(1)}%</span>
      </div>
      <pre className="text-muted-foreground bg-secondary/30 max-h-24 overflow-x-auto overflow-y-auto rounded p-1.5 text-xs">
        {result.content.length > 300 ? result.content.slice(0, 300) + '...' : result.content}
      </pre>
    </div>
  );
};
