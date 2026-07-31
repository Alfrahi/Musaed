// Settings feature public API.
//
// Global Zustand stores (settings-store, model-store) live in `@/store/`, not
// in this feature, because every feature in the app depends on them. Per
// STANDARDS.md §3, store getters MUST NOT be re-exported through a feature
// barrel — consumers import from `@/store/...` directly.
export { useSettingsActions } from './hooks/useSettingsActions';
export { useLogActions } from './hooks/useLogActions';
export { useIpcLatencyStats } from './hooks/useIpcLatency';
export { useIpcViolations } from './hooks/useIpcViolations';
export { useStorageActions } from './hooks/useStorageActions';
export { useStorageCleanup } from './hooks/useStorageCleanup';
export { default as SettingsModal } from './components/SettingsModal';
export { default as SettingsFeature } from './feature.manifest';
