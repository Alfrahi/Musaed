//! RAG feature module — public API.

export { ProjectList } from './components/ProjectList';
export { default as ProjectCard } from './components/ProjectCard';
export { AddProjectDialog } from './components/AddProjectDialog';
export { IndexingProgress } from './components/IndexingProgress';
export { RagContextBadge } from './components/RagContextBadge';
export { SearchResults } from './components/SearchResults';
export { FileBrowser } from './components/FileBrowser';
export { FileChunkViewer } from './components/FileChunkViewer';
export { RagExplorer } from './components/RagExplorer';
export { ProjectSettings } from './components/ProjectSettings';
export { useRagProjects } from './hooks/useRagProjects';
export { useRagIndexing } from './hooks/useRagIndexing';
export { useRagSearch } from './hooks/useRagSearch';
export { useRagContext } from './hooks/useRagContext';
export { useRagFileBrowser } from './hooks/useRagFileBrowser';
export { fileNameFromPath, truncateFilePath, getRelativeFilePath } from './utils/project-helpers';
