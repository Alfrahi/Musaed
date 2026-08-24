import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string) => key),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: mockT,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

vi.mock('@/store', () => ({
  useSettingsStore: (
    selector: (s: {
      globalSettings: { language: string; enableLatex: boolean; enableMermaid: boolean };
    }) => string | boolean
  ) => selector({ globalSettings: { language: 'en', enableLatex: true, enableMermaid: true } }),
  useGlobalSettings: () => ({ theme: 'system', language: 'en' }),
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: (svg: string) => svg,
  },
}));

// Mock mermaid to avoid loading the actual library
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>diagram</svg>' }),
  },
}));

import MarkdownRenderer from './MarkdownRenderer';

describe('MarkdownRenderer without MermaidRenderer mock', () => {
  it('renders list correctly', async () => {
    render(<MarkdownRenderer content="- Item 1\n- Item 2" />);
    console.log('HTML:', screen.getByRole('list').innerHTML);
    expect(screen.getByRole('list')).toBeTruthy();
  });
});
