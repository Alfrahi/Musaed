'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRagFileBrowser } from '@/features/rag/hooks/useRagFileBrowser';
import { useActiveRagProject } from '@/store/rag-store';
import { useLanguage } from '@/store';
import { Loader2, Folder, File, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

interface FileBrowserProps {
  onFileSelect?: (filePath: string) => void;
}

interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}

const TreeNode = ({
  node,
  onFileSelect,
}: {
  node: FileNode;
  onFileSelect?: (path: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    if (node.children) {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect?.(node.path);
    }
  };

  return (
    <div className="my-0.5">
      <div
        className={cn(
          'hover:bg-accent flex cursor-pointer items-center gap-1 rounded-md px-2 py-1',
          !node.children && 'ps-6'
        )}
        onClick={handleToggle}
      >
        {node.children && (
          <Folder className={cn('h-4 w-4 text-yellow-500', isExpanded && 'rotate-90 transform')} />
        )}
        {!node.children && <File className="h-4 w-4 text-blue-500" />}
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded && node.children && (
        <div className="ms-4">
          <TreeNodes nodes={node.children} onFileSelect={onFileSelect} />
        </div>
      )}
    </div>
  );
};

const TreeNodes = ({
  nodes,
  onFileSelect,
}: {
  nodes: FileNode[];
  onFileSelect?: (path: string) => void;
}) => (
  <>
    {nodes.map((node) => (
      <TreeNode key={node.path} node={node} onFileSelect={onFileSelect} />
    ))}
  </>
);

const FileBrowser = ({ onFileSelect }: FileBrowserProps) => {
  const activeProject = useActiveRagProject();
  const { files, isLoading, errorMessage, fetchIndexedFiles, buildFileTree } = useRagFileBrowser();
  const language = useLanguage();
  const { t } = useTranslation(language);

  // Memoize file tree to avoid unnecessary rebuilds when files array reference changes
  const fileTree = useMemo(() => {
    if (files.length === 0) return [];
    return buildFileTree(files);
  }, [files, buildFileTree]);

  useEffect(() => {
    if (activeProject?.id) {
      fetchIndexedFiles(activeProject.id);
    }
  }, [activeProject?.id, fetchIndexedFiles]);

  const handleRefresh = () => {
    if (activeProject?.id) {
      fetchIndexedFiles(activeProject.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="text-destructive p-4 text-sm">
        <p>{errorMessage}</p>
        <Button variant="outline" size="sm" className="mt-2 gap-2" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4" />
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-2">
        <h3 className="text-sm font-medium">{t('rag.indexedFiles')}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-accent rounded-md"
          onClick={handleRefresh}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {fileTree.length > 0 ? (
          <div className="flex flex-col text-sm">
            <TreeNodes nodes={fileTree} onFileSelect={onFileSelect} />
          </div>
        ) : (
          <p className="text-muted-foreground p-2 text-sm">{t('rag.noFilesIndexed')}</p>
        )}
      </div>
    </div>
  );
};

export { FileBrowser };
