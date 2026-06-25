import { describe, it, expect } from 'vitest';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

describe('Locale JSON validity', () => {
  it('English locale should be a non-empty object', () => {
    expect(typeof en).toBe('object');
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it('Arabic locale should be a non-empty object', () => {
    expect(typeof ar).toBe('object');
    expect(Object.keys(ar).length).toBeGreaterThan(0);
  });
});
