// Shared test setup for conversation hook tests
import { beforeEach, vi } from 'vitest';
import { mockAllDependencies } from './mocks';
import { renderHook, act } from '@testing-library/react';

// Setup before each test
beforeEach(() => {
  // Mock all dependencies
  mockAllDependencies();

  // Clear all mocks
  vi.clearAllMocks();
});

export { renderHook, act };
