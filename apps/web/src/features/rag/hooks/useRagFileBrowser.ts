'use client';

import { useCallback, useState } from 'react';
import { ragApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}

export function useRagFileBrowser() {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch all indexed file paths for a project
  const fetchIndexedFiles = useCallback(async (projectId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const fileRecords = await ragApi.listFiles(projectId);

      if (fileRecords && fileRecords.length > 0) {
        const uniqueFiles = Array.from(new Set(fileRecords.map((record) => record.relativePath)));
        setFiles(uniqueFiles);
      } else {
        setFiles([]);
      }
    } catch (err) {
      setErrorMessage('Failed to fetch indexed files.');
      logger.error('Error fetching indexed files:', { error: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch chunks for a specific file
  const fetchFileChunks = useCallback(async (projectId: string, filePath: string) => {
    try {
      const chunks = await ragApi.getFileChunks(projectId, filePath);
      return chunks;
    } catch (err) {
      logger.error('Error fetching file chunks:', { error: String(err) });
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
    errorMessage,
    fetchIndexedFiles,
    fetchFileChunks,
    buildFileTree,
  };
}
