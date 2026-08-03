'use client';

import { useEffect, useRef, useState } from 'react';
import { useRagFileBrowser } from '@/features/rag/hooks/useRagFileBrowser';
import { useActiveRagProject } from '@/store/rag-store';
import { useLanguage } from '@/store';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { ChunkRecord } from '@musaed/contracts';
import { logger } from '@/lib/logger';

interface FileChunkViewerProps {
  filePath: string;
  /** When provided, the viewer scrolls the chunk overlapping this 1-based
   *  line into view on mount. Used by `MessageBubble` citation buttons which
   *  arrive here via a `ModalLayout` and want the cited passage visible
   *  immediately rather than pinned to the top of the file. */
  targetStartLine?: number;
}

const ChunkMetadata = ({ metadata }: { metadata: Record<string, unknown> }) => {
  const entries = Object.entries(metadata).filter(([, value]) => value != null);

  if (entries.length === 0) return null;

  return (
    <div className="text-muted-foreground text-caption mt-2 border-t pt-2">
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

const ChunkCard = ({
  chunk,
  chunkRef,
}: {
  chunk: ChunkRecord;
  chunkRef?: (el: HTMLDivElement | null) => void;
}) => (
  <div ref={chunkRef} className="rounded-md border p-3">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-muted-foreground text-caption font-mono">
        Lines {chunk.startLine}–{chunk.endLine}
        {chunk.metadata?.enclosingEntity != null && (
          <span className="ms-2 font-medium">({String(chunk.metadata.enclosingEntity)})</span>
        )}
      </span>
      <span className="bg-secondary text-caption rounded-full px-2 py-0.5">{chunk.chunkType}</span>
    </div>
    <pre className="text-body font-sans whitespace-pre-wrap">{chunk.content}</pre>
    {chunk.metadata && <ChunkMetadata metadata={chunk.metadata} />}
  </div>
);

const FileChunkViewer = ({ filePath, targetStartLine }: FileChunkViewerProps) => {
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
        logger.error('Error fetching file chunks:', { error: String(err) });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [activeProject?.id, filePath, fetchFileChunks]);

  // Ref callback fired by the ChunkCard that overlaps `targetStartLine`.
  // Stable across renders — recreated only when the target line changes —
  // so React's ref-callback contract (null then el on swap) fires once per
  // target, not on every render. Noop when no target was supplied.
  const targetChunkRef = useRef<(el: HTMLDivElement | null) => void | null>(null);
  if (targetStartLine != null && targetChunkRef.current == null) {
    targetChunkRef.current = (el) => {
      if (el) el.scrollIntoView({ block: 'start' });
    };
  }
  if (targetStartLine == null && targetChunkRef.current != null) {
    targetChunkRef.current = null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="text-destructive text-body flex items-center gap-2 p-4">
        <AlertCircle className="h-4 w-4" />
        <p>{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-2">
        <h3 className="text-body truncate font-medium">
          {t('rag.chunksForFile')} {filePath}
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {chunks.length > 0 ? (
          <div className="space-y-4">
            {chunks.map((chunk) => {
              // First chunk overlapping the cited line range gets the
              // scroll-into-view ref callback; every other chunk renders
              // without a ref. We compare against `targetStartLine` so the
              // viewer lands on the chunk that *contains* the cited start,
              // not on the first chunk in the file.
              const isTarget =
                targetStartLine != null &&
                chunk.startLine <= targetStartLine &&
                chunk.endLine >= targetStartLine;
              return (
                <ChunkCard
                  key={chunk.id}
                  chunk={chunk}
                  chunkRef={isTarget ? (targetChunkRef.current ?? undefined) : undefined}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-body p-2">{t('rag.noChunksForFile')}</p>
        )}
      </div>
    </div>
  );
};

export { FileChunkViewer };
