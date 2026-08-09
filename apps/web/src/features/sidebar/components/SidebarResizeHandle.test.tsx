import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSetGlobalSettings, mockUseSettingsStore, resetWidth } = vi.hoisted(() => {
  let width = 260;
  const mockSetGlobalSettings = vi.fn((settings: { sidebarWidth: number }) => {
    width = settings.sidebarWidth;
  });
  const getState = () => ({
    globalSettings: { sidebarWidth: width },
    setGlobalSettings: mockSetGlobalSettings,
  });
  const useSettingsStore = Object.assign(
    (selector?: (s: ReturnType<typeof getState>) => unknown) => {
      const state = getState();
      if (typeof selector === 'function') return selector(state);
      return state;
    },
    { getState }
  );
  return {
    mockSetGlobalSettings,
    mockGetState: getState,
    mockUseSettingsStore: useSettingsStore,
    resetWidth: (w: number) => {
      width = w;
    },
  };
});

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: mockUseSettingsStore,
}));

vi.mock('@/store', () => ({
  useLanguage: () => 'en',
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isRtl: false,
  }),
}));

import SidebarResizeHandle from './SidebarResizeHandle';

describe('SidebarResizeHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWidth(260);
    document.documentElement.dir = 'ltr';
  });

  it('renders with role separator and correct aria attributes', () => {
    const { getByRole } = render(<SidebarResizeHandle />);
    const handle = getByRole('separator');
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('400');
    expect(handle.getAttribute('aria-valuenow')).toBe('260');
  });

  it('resizes on mouse drag in LTR', () => {
    const { container } = render(<SidebarResizeHandle />);
    const handle = container.firstElementChild!;

    fireEvent.mouseDown(handle, { clientX: 300 });

    act(() => {
      fireEvent.mouseMove(document, { clientX: 350 });
    });

    expect(mockSetGlobalSettings).toHaveBeenCalled();
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(310);
  });

  it('clamps width to 200 minimum on drag', () => {
    const { container } = render(<SidebarResizeHandle />);
    const handle = container.firstElementChild!;

    fireEvent.mouseDown(handle, { clientX: 300 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 50 });
    });
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(200);
  });

  it('clamps width to 400 maximum on drag', () => {
    const { container } = render(<SidebarResizeHandle />);
    const handle = container.firstElementChild!;

    fireEvent.mouseDown(handle, { clientX: 300 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 500 });
    });
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(400);
  });

  it('reverses drag direction in RTL', () => {
    document.documentElement.dir = 'rtl';

    const { container } = render(<SidebarResizeHandle />);
    const handle = container.firstElementChild!;

    fireEvent.mouseDown(handle, { clientX: 300 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 250 });
    });
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(310);
  });

  it('resizes via keyboard ArrowRight in LTR', () => {
    const { getByRole } = render(<SidebarResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(270);
  });

  it('resizes via keyboard ArrowLeft in LTR', () => {
    const { getByRole } = render(<SidebarResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(250);
  });

  it('keyboard resize respects shift modifier for larger steps', () => {
    const { getByRole } = render(<SidebarResizeHandle />);
    const handle = getByRole('separator');

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    const lastCall = mockSetGlobalSettings.mock.calls.at(-1)?.[0] as { sidebarWidth: number };
    expect(lastCall.sidebarWidth).toBe(300);
  });
});
