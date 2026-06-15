/**
 * Model Actions Abstraction Layer
 * Provides controlled access to library model functionality
 * without creating direct feature-to-feature coupling
 */
import { useModelActions as useLibraryModelActions } from '@/features/library';

export function useModelActions() {
  const libraryActions = useLibraryModelActions();

  // Return only the public API that other features should access
  return {
    fetchModels: libraryActions.fetchModels,
    deleteModel: libraryActions.deleteModel,
  };
}
