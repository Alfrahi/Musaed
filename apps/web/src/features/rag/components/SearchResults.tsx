'use client';

import { FileText, Code, FileCode, File } from 'lucide-react';
import { useRagSearchResults, useRagSearchError, useIsRagSearching } from '@/store/rag-store';
import { useSettingsStore } from '@/store';
import { useRagSearch } from '@/features/rag/hooks/useRagSearch';
import { useActiveRagProjectId } from '@/store/rag-store';
import { ErrorFallback, Skeleton } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import type { SearchResult } from '@musaed/contracts';

interface ChunkIconProps {
  type: string;
}

const chunkTypeIcon = ({ type }: ChunkIconProps) => {
  switch (type) {
    case 'code':
      return <Code className="h-3 w-3" data-testid="code-icon" />;
    case 'markdown':
      return <FileText className="h-3 w-3" data-testid="file-text-icon" />;
    case 'config':
      return <FileCode className="h-3 w-3" data-testid="file-code-icon" />;
    default:
      return <File className="h-3 w-3" data-testid="file-icon" />;
  }
};

export const SearchResults = () => {
  const results = useRagSearchResults();
  const searchError = useRagSearchError();
  const isSearching = useIsRagSearching();
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const { t } = useTranslation(globalSettings.language);
  const { search } = useRagSearch();
  const activeProjectId = useActiveRagProjectId();

  if (isSearching) {
    return (
      <div className="space-y-2" data-testid="search-results-loading">
        <Skeleton className="h-4 w-32 rounded-sm" />
        <div className="space-y-1.5">
          <Skeleton className="h-20 w-full rounded-md" />
          <Skeleton className="h-20 w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (searchError) {
    return (
      <div className="space-y-2" data-testid="search-results-error">
        <ErrorFallback
          type="ollama"
          compact
          description={searchError}
          onRetry={() => {
            if (activeProjectId) {
              search({ projectId: activeProjectId, query: '' });
            }
          }}
        />
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="search-results-container">
      <p className="text-muted-foreground text-caption font-medium">
        {t('rag.searchResultCount', { count: results.length })}
      </p>
      <div className="max-h-80 space-y-1.5 overflow-y-auto" role="list">
        {results.map((result, i) => (
          <SearchResultCard key={`${result.chunkId}-${i}`} result={result} rank={i + 1} />
        ))}
      </div>
    </div>
  );
};

const SearchResultCard = ({ result, rank }: { result: SearchResult; rank: number }) => {
  return (
    <div className="border-border space-y-1 rounded-md border p-2" role="article">
      <div className="text-caption flex items-center gap-2">
        <span className="text-muted-foreground">#{rank}</span>
        {chunkTypeIcon({ type: result.chunkType })}
        <span className="truncate font-medium">{result.filePath}</span>
        <span className="text-muted-foreground">
          L{result.startLine}-{result.endLine}
        </span>
        {result.language && (
          <span className="text-muted-foreground bg-accent/50 caption-xs rounded px-1">
            {result.language}
          </span>
        )}
        <span className="text-muted-foreground ms-auto">{(result.score * 100).toFixed(1)}%</span>
      </div>
      <pre className="text-muted-foreground bg-secondary/30 text-caption max-h-24 overflow-x-auto overflow-y-auto rounded p-1.5">
        {result.content.length > 300 ? result.content.slice(0, 300) + '...' : result.content}
      </pre>
    </div>
  );
};
