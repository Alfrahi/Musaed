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

import { initOnce, nextDiagramId, resetMermaidService } from './mermaid-service';

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
      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(1);
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
        })
      );
    });

    it('does not re-initialize when called again with the same theme', () => {
      initOnce('default');
      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('re-initializes when theme changes', () => {
      initOnce('default');
      initOnce('forest');
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });

    it('re-initializes when dark mode toggles', () => {
      document.documentElement.classList.add('dark');
      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      document.documentElement.classList.remove('dark');
      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(2);
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
      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      resetMermaidService();
      initOnce('default');
      expect(mockInitialize).toHaveBeenCalledTimes(2);
    });
  });
});
