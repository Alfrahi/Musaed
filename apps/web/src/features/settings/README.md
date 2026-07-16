# Settings Feature

## Purpose

Manages application-wide configuration — Ollama connection, model parameters, theme, language, markdown rendering, input behavior, storage cleanup, and diagnostics. Also manages the model store (installed Ollama models).

## Public API (`index.ts`)

### Hooks

| Export               | Source                        | Description                                        |
| -------------------- | ----------------------------- | -------------------------------------------------- |
| `useSettingsActions` | `hooks/useSettingsActions.ts` | Read/update global settings, commit to persistence |
| `useLogActions`      | `hooks/useLogActions.ts`      | View and clear application logs                    |
| `useStorageActions`  | `hooks/useStorageActions.ts`  | Inspect storage usage per feature                  |
| `useStorageCleanup`  | `hooks/useStorageCleanup.ts`  | Clear cached data and reset storage                |

### Stores

| Export           | Source                    | Description                                                                   |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `settings-store` | `store/settings-store.ts` | Global application settings (theme, language, model params, etc.) (schema v1) |
| `model-store`    | `store/model-store.ts`    | Installed Ollama models registry (schema v1)                                  |

### Feature Manifest

| Export            | Source                | Description                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------------- |
| `SettingsFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

All components are internal — **not** re-exported from `index.ts` (per DDD rules). They are rendered inside the `SettingsModal` which is imported directly by the `layout` composition layer.

| Component             | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `SettingsModal`       | Top-level modal that hosts all settings tabs         |
| `OllamaSettings`      | Ollama endpoint URL, health check, connection status |
| `ModelParamsSettings` | Temperature, top-p, context length, etc.             |
| `ThemeSettings`       | Light/dark/system theme selection                    |
| `LanguageSettings`    | UI language selection (en/ar)                        |
| `MarkdownSettings`    | Markdown rendering preferences                       |
| `InputSettings`       | Input behavior (enter to send, etc.)                 |
| `StorageSettings`     | Storage usage display and cleanup controls           |
| `LogViewer`           | Application log viewer with filtering                |
| `DiagnosticsSettings` | System diagnostics and debug info                    |

## IPC Endpoints

| Command                     | Purpose                               |
| --------------------------- | ------------------------------------- |
| `cmd_ollama_get_models`     | List installed Ollama models          |
| `cmd_ollama_delete_model`   | Delete an installed model             |
| `cmd_ollama_pull_model`     | Pull a new model from Ollama registry |
| `cmd_ollama_check_health`   | Check Ollama service health           |
| `cmd_ollama_verify_service` | Verify Ollama service connectivity    |
| `cmd_ollama_validate_model` | Validate a model name                 |
| `cmd_logs_append`           | Append a log entry                    |
| `cmd_logs_clear`            | Clear all logs                        |

## State Schemas

| Store               | Version | Persistence Key                              |
| ------------------- | ------- | -------------------------------------------- |
| `settingsStore`     | 1       | `musaed-settings-storage`                    |
| `conversationStore` | 3       | (read-only access for conversation settings) |
| `modelStore`        | 1       | `musaed-model-storage-v1`                    |
| `logs`              | —       | `logs.json`                                  |

## Dependencies

- `library` — accesses model management via `lib/useModelActions` abstraction (not a direct feature import)

## Example Usage

```tsx
import { useSettingsActions } from '@/features/settings';

function ThemeToggle() {
  const { settings, updateSettings } = useSettingsActions();

  const toggle = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  return <button onClick={toggle}>Toggle theme</button>;
}
```

## Related Docs

- [Migration Framework](../../../docs/migration-framework.md)
- [Structured Logging](../../../docs/structured-logging.md)
