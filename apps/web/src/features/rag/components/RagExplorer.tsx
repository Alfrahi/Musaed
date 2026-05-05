'use client';

import { useState } from 'react';
import { FileBrowser } from './FileBrowser';
import { FileChunkViewer } from './FileChunkViewer';

const RagExplorer = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      <div className="w-1/3 min-w-[200px] border-e">
        <FileBrowser onFileSelect={setSelectedFile} />
      </div>
      <div className="flex-1">
        {selectedFile ? (
          <FileChunkViewer filePath={selectedFile} />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <p>Select a file to view its chunks</p>
          </div>
        )}
      </div>
    </div>
  );
};

export { RagExplorer };
