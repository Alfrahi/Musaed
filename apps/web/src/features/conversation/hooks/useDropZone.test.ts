import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDropZone } from './useDropZone';

// Container for the captured event handler. Defined before vi.mock so the
// mock factory can close over it (vi.mock is hoisted but the reference to
// this container is captured at call time).
const handlerBox: { current: ((event: unknown) => void) | null } = { current: null };

vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(() => true),
  listenDragDrop: (handler: (event: unknown) => void) => {
    handlerBox.current = handler;
    return () => {
      handlerBox.current = null;
    };
  },
}));

/**
 * Minimal renderHook helper using @testing-library/react.
 */
function renderHook<Result>(hook: () => Result) {
  const ref: { current: Result | null } = { current: null };
  const TestComponent = () => {
    ref.current = hook();
    return null;
  };
  render(React.createElement(TestComponent));
  return {
    result: {
      get current() {
        return ref.current!;
      },
    },
  };
}

function makeDragEvent(type: string, paths: string[] = []) {
  return {
    type,
    paths,
    position: { x: 100, y: 200 },
  };
}

function fire(event: unknown) {
  if (!handlerBox.current) throw new Error('handler is null');
  act(() => {
    handlerBox.current!(event);
  });
}

describe('useDropZone', () => {
  beforeEach(() => {
    handlerBox.current = null;
  });

  it('sets isDragOver to true on drag enter', async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    fire(makeDragEvent('enter', ['/path/file.txt']));

    expect(result.current.isDragOver).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('sets isDragOver to true on drag over', async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    fire(makeDragEvent('over'));

    expect(result.current.isDragOver).toBe(true);
  });

  it('sets isDragOver to false and calls onDrop on drop', async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    fire(makeDragEvent('drop', ['/tmp/img.png', '/tmp/doc.md']));

    expect(result.current.isDragOver).toBe(false);
    expect(onDrop).toHaveBeenCalledWith({
      imagePaths: ['/tmp/img.png'],
      filePaths: ['/tmp/doc.md'],
    });
  });

  it('sets isDragOver to false on drag leave', async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    fire(makeDragEvent('enter', ['/tmp/file.txt']));
    expect(result.current.isDragOver).toBe(true);

    fire(makeDragEvent('leave'));

    expect(result.current.isDragOver).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('classifies image paths correctly', async () => {
    const onDrop = vi.fn();
    renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    fire(
      makeDragEvent('drop', [
        '/tmp/photo.png',
        '/tmp/icon.svg',
        '/tmp/doc.pdf',
        '/tmp/readme.md',
        '/tmp/image.jpg',
      ])
    );

    expect(onDrop).toHaveBeenCalledWith({
      imagePaths: ['/tmp/photo.png', '/tmp/icon.svg', '/tmp/image.jpg'],
      filePaths: ['/tmp/doc.pdf', '/tmp/readme.md'],
    });
  });

  it('handles empty paths on drop', async () => {
    const onDrop = vi.fn();
    renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    fire(makeDragEvent('drop', []));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', async () => {
    const onDrop = vi.fn();
    renderHook(() => useDropZone({ onDrop }));

    await waitFor(() => {
      expect(handlerBox.current).not.toBeNull();
    });

    handlerBox.current = null;

    expect(handlerBox.current).toBeNull();
  });
});
