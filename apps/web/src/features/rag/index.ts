//! RAG feature module — public API.

export { useRagProjects } from './hooks/useRagProjects';
export { useRagIndexing } from './hooks/useRagIndexing';
export { useRagSearch } from './hooks/useRagSearch';
export { useRagContext } from './hooks/useRagContext';
export { useRagFileBrowser } from './hooks/useRagFileBrowser';
export { fileNameFromPath, truncateFilePath, getRelativeFilePath } from './utils/project-helpers';
export { default as RagFeature } from './feature.manifest';
