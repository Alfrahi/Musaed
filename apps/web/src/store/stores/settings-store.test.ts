import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from './settings-store';
import { DEFAULT_SETTINGS } from '@musaed/contracts';

describe('Settings Store', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      globalSettings: DEFAULT_SETTINGS,
    });
  });

  it('updates global settings partially', () => {
    useSettingsStore.getState().setGlobalSettings({ ...DEFAULT_SETTINGS, temperature: 0.9 });
    expect(useSettingsStore.getState().globalSettings.temperature).toBe(0.9);
    expect(useSettingsStore.getState().globalSettings.language).toBe('en');
  });
});