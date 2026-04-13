import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';

describe('UI Store', () => {
  beforeEach(() => {
    useUIStore.setState({
      isStreaming: false,
      isInitialized: false,
      error: null,
      isSettingsOpen: false,
    });
  });

  it('updates streaming state', () => {
    useUIStore.getState().setStreaming(true);
    expect(useUIStore.getState().isStreaming).toBe(true);
  });

  it('sets and clears errors', () => {
    useUIStore.getState().setError('Failed to fetch');
    expect(useUIStore.getState().error).toBe('Failed to fetch');
    
    useUIStore.getState().setError(null);
    expect(useUIStore.getState().error).toBeNull();
  });

  it('toggles settings modal', () => {
    useUIStore.getState().setSettingsOpen(true);
    expect(useUIStore.getState().isSettingsOpen).toBe(true);
  });
});