/**
 * Settings Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

export default {
  name: 'settings',
  version: '1.0.0',
  publicApi: {
    components: [
      'SettingsModal',
      'LogViewer',
      'ThemeSettings',
      'MarkdownSettings',
      'ModelParamsSettings',
      'OllamaSettings',
      'StorageSettings',
      'DiagnosticsSettings',
      'InputSettings',
      'LanguageSettings',
    ],
    hooks: ['useSettingsActions', 'useLogActions', 'useStorageActions', 'useStorageCleanup'],
    utils: [],
  },
  ipcEndpoints: [
    'cmd_ollama_get_models',
    'cmd_ollama_delete_model',
    'cmd_ollama_pull_model',
    'cmd_ollama_check_health',
    'cmd_ollama_verify_service',
    'cmd_ollama_validate_model',
    'cmd_logs_append',
    'cmd_logs_clear',
  ],
  stateSchemas: {
    settingsStore: 1,
    conversationStore: 3,
  },
  persistenceSchemas: {
    settings: 'musaed-settings-storage',
    logs: 'logs.json',
  },
  dependencies: [],
} as const;
