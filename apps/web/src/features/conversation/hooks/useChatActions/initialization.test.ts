// Tests for useChatActions initialization
import { describe, it, expect } from 'vitest';
import { renderHook } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { useUIStore } from '@/store/ui-store';

describe('useChatActions - Initialization', () => {
  it('initializes with required dependencies', () => {
    const { result } = renderHook(() => useChatActions());
    const { result: uiResult } = renderHook(() => useUIStore());

    expect(result.current).toBeDefined();
    expect(result.current.sendMessage).toBeInstanceOf(Function);
    expect(result.current.abortMessage).toBeInstanceOf(Function);
    expect(uiResult.current.isStreaming).toBe(false);
  });
});
