'use client';

import { useEffect, useState } from 'react';
import { useRagFileBrowser } from '../hooks/useRagFileBrowser';
import { useActiveRagProject } from '../store/rag-store';
import { useLanguage } from '../../settings/store/settings-store';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import type { ChunkRecord } from '@musaed/contracts';

interface FileChunkViewerProps {
  filePath: string;
}

const ChunkMetadata = ({ metadata }: { metadata: Record<string, unknown> }) => {
  const entries = Object.entries(metadata).filter(([, value]) => value != null);

  if (entries.length === 0) return null;

  return (
    <div className="text-muted-foreground mt-2 border-t pt-2 text-xs">
      <p className="font-medium">Metadata:</p>
      {metadata.enclosingEntity != null && (
        <p>
          <span className="font-medium">Enclosing Entity:</span> {String(metadata.enclosingEntity)}
        </p>
      )}
      {Array.isArray(metadata.names) && metadata.names.length > 0 && (
        <p>
          <span className="font-medium">Names:</span> {metadata.names.map(String).join(', ')}
        </p>
      )}
      {metadata.imports != null && (
        <p>
          <span className="font-medium">Imports:</span> {String(metadata.imports)}
        </p>
      )}
    </div>
  );
};

const ChunkCard = ({ chunk }: { chunk: ChunkRecord }) => (
  <div className="rounded-md border p-3">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-muted-foreground font-mono text-xs">
        Lines {chunk.startLine}–{chunk.endLine}
        {chunk.metadata?.enclosingEntity != null && (
          <span className="ms-2 font-medium">({String(chunk.metadata.enclosingEntity)})</span>
        )}
      </span>
      <span className="bg-secondary rounded-full px-2 py-0.5 text-xs">{chunk.chunkType}</span>
    </div>
    <pre className="font-sans text-sm whitespace-pre-wrap">{chunk.content}</pre>
    {chunk.metadata && <ChunkMetadata metadata={chunk.metadata} />}
  </div>
);

const FileChunkViewer = ({ filePath }: FileChunkViewerProps) => {
  const activeProject = useActiveRagProject();
  const { fetchFileChunks } = useRagFileBrowser();
  const { t } = useTranslation(useLanguage());
  const [chunks, setChunks] = useState<ChunkRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject?.id || !filePath) return;

    setIsLoading(true);
    setErrorMessage(null);

    fetchFileChunks(activeProject.id, filePath)
      .then((data) => {
        setChunks(data || []);
      })
      .catch((err: unknown) => {
        setErrorMessage('Failed to fetch file chunks.');
        console.error('Error fetching file chunks:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [activeProject?.id, filePath, fetchFileChunks]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="text-destructive flex items-center gap-2 p-4 text-sm">
        <AlertCircle className="h-4 w-4" />
        <p>{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-2">
        <h3 className="truncate text-sm font-medium">
          {t('rag.chunksForFile')} {filePath}
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {chunks.length > 0 ? (
          <div className="space-y-4">
            {chunks.map((chunk) => (
              <ChunkCard key={chunk.id} chunk={chunk} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground p-2 text-sm">{t('rag.noChunksForFile')}</p>
        )}
      </div>
    </div>
  );
};

export { FileChunkViewer };
