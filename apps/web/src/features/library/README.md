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

| Export                 | Source                          | Description                                             |
| ---------------------- | ------------------------------- | ------------------------------------------------------- |
| `useModelPulling`      | `hooks/useModelPulling.ts`      | Pull model progress tracking and cancellation           |
| `useModelActions`      | `hooks/useModelActions.ts`      | Install, delete, and select models                      |
| `useModelCapabilities` | `hooks/useModelCapabilities.ts` | Query model capabilities (context length, vision, etc.) |

### Feature Manifest

| Export           | Source                | Description                                                      |
| ---------------- | --------------------- | ---------------------------------------------------------------- |
| `LibraryFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

| Component             | Description                                 |
| --------------------- | ------------------------------------------- |
| `InstalledModelCard`  | Card variant for an already-installed model |
| `LibrarySearchHeader` | Search/filter header for the model library  |

## IPC Endpoints

| Command                     | Purpose                               |
| --------------------------- | ------------------------------------- |
| `cmd_ollama_get_models`     | List installed Ollama models          |
| `cmd_ollama_delete_model`   | Delete an installed model             |
| `cmd_ollama_pull_model`     | Pull a new model from Ollama registry |
| `cmd_ollama_check_health`   | Check Ollama service health           |
| `cmd_ollama_verify_service` | Verify Ollama service connectivity    |
| `cmd_ollama_validate_model` | Validate a model name                 |

## State Schemas

| Store        | Version | Persistence Key           |
| ------------ | ------- | ------------------------- |
| `modelStore` | 1       | `musaed-model-storage-v1` |

## Dependencies

None — standalone feature. The `settings` feature depends on `library` via the `lib/useModelActions` abstraction.

## Example Usage

```tsx
import { ModelSelector, useModelActions } from '@/features/library';

function ModelPicker() {
  const { selectedModel, selectModel } = useModelActions();
  return <ModelSelector value={selectedModel} onChange={selectModel} />;
}
```

## Related Docs

- [Migration Framework](../../../docs/migration-framework.md)
