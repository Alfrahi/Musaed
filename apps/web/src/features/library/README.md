# Library Feature

## Purpose

Manages the Ollama model library — browsing installed models, pulling new models, viewing model capabilities, and selecting models for chat. Provides the model selection UI used by the chat input and settings.

## Public API (`index.ts`)

### Components

| Export          | Source                         | Description                                       |
| --------------- | ------------------------------ | ------------------------------------------------- |
| `ModelLibrary`  | `components/ModelLibrary.tsx`  | Full model library view — install, browse, delete |
| `ModelCard`     | `components/ModelCard.tsx`     | Individual model card with metadata and actions   |
| `ModelSelector` | `components/ModelSelector.tsx` | Dropdown selector for active model                |

### Hooks

| Export                     | Source                              | Description                                             |
| -------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `useModelPulling`          | `hooks/useModelPulling.ts`          | Pull model progress tracking and cancellation           |
| `useModelActions`          | `hooks/useModelActions.ts`          | Install, delete, and select models                      |
| `useModelCapabilities`     | `hooks/useModelCapabilities.ts`     | Query model capabilities (context length, vision, etc.) |
| `useEmbeddingModels`       | `hooks/useEmbeddingModels.ts`       | Manage embedding models for RAG                         |
| `useLibraryInitialization` | `hooks/useLibraryInitialization.ts` | Initialize library from Rust backend at boot            |
| `useLibraryTauriEvents`    | `hooks/useLibraryTauriEvents.ts`    | Subscribe to Tauri events for library updates           |
| `useModelContextWindow`    | `hooks/useModelContextWindow.ts`    | Get model context window information                    |

### Types

| Export                   | Source                           | Description                               |
| ------------------------ | -------------------------------- | ----------------------------------------- |
| `ModelContextWindowInfo` | `hooks/useModelContextWindow.ts` | Type for model context window information |

### Feature Manifest

| Export           | Source                | Description                                                      |
| ---------------- | --------------------- | ---------------------------------------------------------------- |
| `LibraryFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

| Component             | Description                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InstalledModelCard`  | Card variant for an already-installed model                                                                                                                                    |
| `LibrarySearchHeader` | Search/filter header for the model library                                                                                                                                     |
| `ModelParamsPanel`    | Per-model sampling parameter sliders (temperature, top-p, context length, etc.). Now mounted inline inside the `ModelSelector` dropdown rather than the global settings modal. |

## IPC Endpoints

| Command                     | Purpose                               |
| --------------------------- | ------------------------------------- |
| `cmd_ollama_get_models`     | List installed Ollama models          |
| `cmd_ollama_delete_model`   | Delete an installed model             |
| `cmd_ollama_pull_model`     | Pull a new model from Ollama registry |
| `cmd_ollama_abort_pull`     | Abort an active model pull            |
| `cmd_ollama_validate_model` | Validate a model name                 |

## State Schemas

| Store        | Version | Persistence Key        |
| ------------ | ------- | ---------------------- |
| `modelStore` | 1       | `musaed-model-storage` |

## Dependencies

None — standalone feature. The `settings` feature depends on `library` via the `lib/useModelActions` abstraction.

## Example Usage

```tsx
import { ModelSelector, useModelActions } from '@/features/library';

function ModelPicker() {
  const { fetchModels, isFetching } = useModelActions();
  return <ModelSelector />;
}
```

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
