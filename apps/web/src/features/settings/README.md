# Settings Feature

## Purpose

Manages application-wide configuration — Ollama connection, model parameters, theme, language, markdown rendering, input behavior, storage cleanup, and diagnostics. Also manages the model store (installed Ollama models).

## Public API (`index.ts`)

### Hooks

| Export                      | Source                               | Description                                        |
| --------------------------- | ------------------------------------ | -------------------------------------------------- |
| `useSettingsActions`        | `hooks/useSettingsActions.ts`        | Read/update global settings, commit to persistence |
| `useLogActions`             | `hooks/useLogActions.ts`             | View and clear application logs                    |
| `useStorageActions`         | `hooks/useStorageActions.ts`         | Inspect storage usage per feature                  |
| `useStorageCleanup`         | `hooks/useStorageCleanup.ts`         | Clear cached data and reset storage                |
| `useIpcLatencyStats`        | `hooks/useIpcLatency.ts`             | Monitor IPC latency statistics                     |
| `useIpcViolations`          | `hooks/useIpcViolations.ts`          | Track IPC violation events                         |
| `useSettingsInitialization` | `hooks/useSettingsInitialization.ts` | Initialize settings from Rust backend at boot      |

### Components

| Export          | Source                         | Description                                     |
| --------------- | ------------------------------ | ----------------------------------------------- |
| `SettingsModal` | `components/SettingsModal.tsx` | Main settings modal with all configuration tabs |

### Feature Manifest

| Export            | Source                | Description                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------------- |
| `SettingsFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions |

## Key Components (internal)

All components are internal — **not** re-exported from `index.ts` (per DDD rules). They are rendered inside the `SettingsModal` which is imported directly by the `layout` composition layer.

| Component             | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `SettingsModal`       | Top-level modal that hosts all settings tabs              |
| `SettingsCard`        | Shared card container used by individual settings panels  |
| `OllamaSettings`      | Ollama endpoint URL, health check, connection status      |
| `ThemeSettings`       | Light/dark/system theme selection                         |
| `LanguageSettings`    | UI language selection (en/ar)                             |
| `MarkdownSettings`    | Markdown rendering preferences                            |
| `InputSettings`       | Input behavior (enter to send, etc.)                      |
| `WindowSettings`      | Window behavior (close to tray, etc.)                     |
| `StorageSettings`     | Storage usage display and cleanup controls                |
| `LogViewer`           | Application log viewer with filtering                     |
| `DiagnosticsSettings` | System diagnostics and debug info                         |
| `IpcLatencyPanel`     | IPC latency monitoring panel (mounted inside Diagnostics) |

## IPC Endpoints

| Command                        | Purpose                            |
| ------------------------------ | ---------------------------------- |
| `cmd_ollama_verify_service`    | Verify Ollama service connectivity |
| `cmd_logs_request_clear_token` | Request log clearance token        |
| `cmd_logs_clear`               | Clear all logs                     |
| `cmd_store_load`               | Load store data                    |
| `cmd_store_get`                | Get store value                    |
| `cmd_store_set`                | Set store value                    |
| `cmd_store_save`               | Save store data                    |
| `cmd_dialog_save_file`         | Save file dialog                   |
| `cmd_fs_write_text_file`       | Write text file                    |
| `cmd_dialog_open_file`         | Open file dialog                   |
| `cmd_fs_read_text_file`        | Read text file                     |

## State Schemas

| Store               | Version | Persistence Key                              |
| ------------------- | ------- | -------------------------------------------- |
| `settingsStore`     | 4       | `musaed-settings-storage`                    |
| `conversationStore` | 3       | (read-only access for conversation settings) |
| `modelStore`        | 1       | `musaed-model-storage`                       |
| `logs`              | —       | `logs.json`                                  |

## Dependencies

- `library` — accesses model management via `lib/useModelActions` abstraction (not a direct feature import)

## Example Usage

```tsx
import { useSettingsActions } from '@/features/settings';
import { useGlobalSettings } from '@/store/settings-store';

function ThemeToggle() {
  const settings = useGlobalSettings();
  const { updateGlobalSettings } = useSettingsActions();

  const toggle = () => {
    updateGlobalSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  return <button onClick={toggle}>Toggle theme</button>;
}
```

> **Note:** Reading the current settings comes from `useGlobalSettings()` on `@/store/settings-store` (a global store, not the settings feature barrel). The settings feature hook only exposes the actions — `updateGlobalSettings` and `resetGlobalSettings`.

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
- [Structured Logging](../../../../../docs/structured-logging.md)
