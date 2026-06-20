import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';

describe('UI Store', () => {
  beforeEach(() => {
    useUIStore.setState({
      isStreaming: false,
      isInitialized: false,
      errorMessage: null,
      isSettingsOpen: false,
    });
  });

  it('updates streaming state', () => {
    useUIStore.getState().setStreaming(true);
    expect(useUIStore.getState().isStreaming).toBe(true);
  });

  it('sets and clears errors', () => {
    useUIStore.getState().setErrorMessage('Failed to fetch');
    expect(useUIStore.getState().errorMessage).toBe('Failed to fetch');

    useUIStore.getState().setErrorMessage(null);
    expect(useUIStore.getState().errorMessage).toBeNull();
  });

  it('toggles settings modal', () => {
    useUIStore.getState().setSettingsOpen(true);
    expect(useUIStore.getState().isSettingsOpen).toBe(true);
  });
});
