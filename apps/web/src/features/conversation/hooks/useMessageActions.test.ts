import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMessageActions } from './useMessageActions';
import type { Message } from '@musaed/contracts';

const writeText = vi.fn();

const baseMessage: Message = {
  id: 'msg-1',
  role: 'assistant',
  content: 'Hello<redacted-thinking>secret</redacted-thinking> World',
  timestamp: Date.now(),
};

describe('useMessageActions', () => {
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('copies the full message with thinking blocks stripped by default', () => {
    const { result } = renderHook(() => useMessageActions(baseMessage));

    result.current.handleCopy();

    expect(writeText).toHaveBeenCalledWith('Hello World');
  });

  it('copies overrideText instead of the message when provided', () => {
    // Context-menu Copy passes the user's current text selection.
    const { result } = renderHook(() => useMessageActions(baseMessage));

    result.current.handleCopy('just this part');

    expect(writeText).toHaveBeenCalledWith('just this part');
  });

  it('falls back to the stripped message for an empty override', () => {
    const { result } = renderHook(() => useMessageActions(baseMessage));

    result.current.handleCopy('');

    expect(writeText).toHaveBeenCalledWith('Hello World');
  });

  it('flips the copied flag back off after the feedback timeout', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMessageActions(baseMessage));

      act(() => {
        result.current.handleCopy();
      });
      expect(result.current.copied).toBe(true);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.copied).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
