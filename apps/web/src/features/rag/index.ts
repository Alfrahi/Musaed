//! RAG feature module — public API.

export { useRagProjects } from './hooks/useRagProjects';
export { useRagIndexing } from './hooks/useRagIndexing';
export { useRagSearch } from './hooks/useRagSearch';
export { useRagAssembleContext } from './hooks/useRagAssembleContext';
export { useRagFileBrowser } from './hooks/useRagFileBrowser';
export { ProjectList } from './components/ProjectList';
export { AddProjectDialog } from './components/AddProjectDialog';
export { RagExplorer } from './components/RagExplorer';
export { ProjectSettings } from './components/ProjectSettings';
export { FileChunkViewer } from './components/FileChunkViewer';
export { RagContextBadge } from './components/RagContextBadge';
export {
  fileNameFromPath,
  truncateFilePath,
  getRelativeFilePath,
  deriveProjectStatus,
  type ProjectStatusPatch,
} from './utils/project-helpers';
export { default as RagFeature } from './feature.manifest';
