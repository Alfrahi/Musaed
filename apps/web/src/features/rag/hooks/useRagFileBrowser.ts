'use client';

import { useCallback, useState } from 'react';
import { ragApi } from '../../../lib/ipc';
import { useOllamaUrl } from '../../../store/hooks';

interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}

export function useRagFileBrowser() {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ollamaUrl = useOllamaUrl();

  // Fetch all unique file paths for a project by searching with a broad query
  const fetchIndexedFiles = useCallback(
    async (projectId: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // Use a broad search to discover all indexed files
        const results = await ragApi.search({
          projectId,
          query: '*',
          topK: 1000,
          baseUrl: ollamaUrl,
        });

        if (results && results.length > 0) {
          // Extract unique file paths from search results
          const uniqueFiles = Array.from(new Set(results.map((result) => result.filePath)));
          setFiles(uniqueFiles);
        } else {
          setFiles([]);
        }
      } catch (err) {
        setError('Failed to fetch indexed files.');
        console.error('Error fetching indexed files:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [ollamaUrl]
  );

  // Fetch chunks for a specific file
  const fetchFileChunks = useCallback(async (projectId: string, filePath: string) => {
    try {
      const chunks = await ragApi.getFileChunks(projectId, filePath);
      return chunks;
    } catch (err) {
      console.error('Error fetching file chunks:', err);
      throw err;
    }
  }, []);

  // Convert flat file paths into a nested tree structure
  const buildFileTree = useCallback((filePaths: string[]): FileNode[] => {
    const root: FileNode[] = [];

    filePaths.forEach((filePath) => {
      const parts = filePath.split(/[/\\]/);
      let currentLevel = root;

      parts.forEach((part, index) => {
        const existingNode = currentLevel.find((node) => node.name === part);

        if (existingNode) {
          currentLevel = existingNode.children || [];
        } else {
          const newNode: FileNode = {
            name: part,
            path: parts.slice(0, index + 1).join('/'),
          };

          if (index < parts.length - 1) {
            newNode.children = [];
          }

          currentLevel.push(newNode);
          currentLevel = newNode.children || [];
        }
      });
    });

    return root;
  }, []);

  return {
    files,
    isLoading,
    error,
    fetchIndexedFiles,
    fetchFileChunks,
    buildFileTree,
  };
}
