import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockInitialize, mockRender } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockRender: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

import {
  initOnce,
  nextDiagramId,
  resetMermaidService,
  resetForThemeChange,
} from './mermaid-service';

describe('mermaid-service', () => {
  beforeEach(() => {
    mockInitialize.mockClear();
    resetMermaidService();
  });

  afterEach(() => {
    resetMermaidService();
  });

  describe('initOnce', () => {
    it('calls mermaid.initialize on first call', () => {
      initOnce('default', false);
      expect(mockInitialize).toHaveBeenCalledTimes(1);
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
        })
      );
    });

    it('does not re-initialize when called again with the same theme and isDark', () => {
      initOnce('default', false);
      initOnce('default', false);
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('re-initializes when theme changes', () => {
      initOnce('default', false);
      initOnce('forest', false);
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });

    it('re-initializes when isDark changes', () => {
      initOnce('default', false);
      initOnce('default', true);
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetForThemeChange', () => {
    it('re-initializes mermaid with new theme and isDark', () => {
      initOnce('default', false);
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      resetForThemeChange('dark', true);
      expect(mockInitialize).toHaveBeenCalledTimes(2);
      expect(mockInitialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));
    });
  });

  describe('nextDiagramId', () => {
    it('returns sequential deterministic IDs', () => {
      resetMermaidService();
      expect(nextDiagramId()).toBe('mermaid-diagram-1');
      expect(nextDiagramId()).toBe('mermaid-diagram-2');
      expect(nextDiagramId()).toBe('mermaid-diagram-3');
    });

    it('does not reuse IDs across calls', () => {
      resetMermaidService();
      const id1 = nextDiagramId();
      const id2 = nextDiagramId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('resetMermaidService', () => {
    it('allows re-initialization after reset', () => {
      initOnce('default', false);
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      initOnce('default', false);
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      resetMermaidService();
      initOnce('default', false);
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });
  });
});
