import { stripThinkingBlocks } from '../redactedThinking';
import type { StripResult } from './workerUtils';

/**
 * Async wrapper that uses a Web Worker pool to strip thinking blocks.
 * Falls back to the synchronous implementation if the worker fails.
 */
export async function stripThinkingBlocksAsync(content: string): Promise<StripResult> {
  try {
    const { stripThinkingBlocksWorker } = await import('./workerUtils');
    return await stripThinkingBlocksWorker(content);
  } catch (error) {
    console.warn('Web Worker failed, falling back to synchronous stripThinkingBlocks:', error);
    return { content: stripThinkingBlocks(content), method: 'sync' };
  }
}

/** @deprecated Use stripThinkingBlocksAsync instead. */
export async function stripRedactedThinkingBlocksAsync(content: string): Promise<StripResult> {
  return stripThinkingBlocksAsync(content);
}
