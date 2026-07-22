// Settings feature public API.
//
// Global Zustand stores (settings-store, model-store) live in `@/store/`, not
// in this feature, because every feature in the app depends on them. This barrel
// re-exports their public selectors/actions so non-feature callers can still
// reach them via the documented public surface (`@/features/settings`). Feature
// callers should import directly from `@/store/...`. See STANDARDS.md §22.
export { useSettingsActions } from './hooks/useSettingsActions';
export { useLogActions } from './hooks/useLogActions';
export { useIpcLatencyStats } from './hooks/useIpcLatency';
export { useIpcViolations } from './hooks/useIpcViolations';
export * from '@/store/settings-store';
export * from '@/store/model-store';
export { useStorageActions } from './hooks/useStorageActions';
export { useStorageCleanup } from './hooks/useStorageCleanup';
export { default as SettingsModal } from './components/SettingsModal';
export { default as SettingsFeature } from './feature.manifest';
