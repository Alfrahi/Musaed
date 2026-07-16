// Debug test for useChatActions
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { mockIpc, mockStores, mockAllDependencies } from './shared/mocks';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
});

describe('useChatActions - Debug', () => {
  it('should initialize correctly', () => {
    const { result } = renderHook(() => useChatActions());

    console.log('Hook result:', result.current);
    console.log('Mock stores:', mockStores);
    console.log('Mock IPC:', mockIpc);

    expect(result.current).toBeDefined();
    expect(result.current.sendMessage).toBeInstanceOf(Function);
    expect(result.current.abortMessage).toBeInstanceOf(Function);
  });
});
