"use client";

import { logger } from './logger';

export interface RetryOptions {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterFactor: number; // Random jitter to avoid thundering herd (0-1)
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
};

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
    attempt: number,
    options: RetryOptions
): number {
    const exponentialDelay = Math.min(
        options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt),
                                      options.maxDelayMs
    );

    // Add jitter: random value between 0 and jitterFactor% of delay
    const jitter = exponentialDelay * options.jitterFactor * Math.random();

    return exponentialDelay + jitter;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: any): boolean {
    // Network errors
    if (error?.message?.includes('timeout')) return true;
    if (error?.message?.includes('ECONNREFUSED')) return true;
    if (error?.message?.includes('ECONNRESET')) return true;
    if (error?.message?.includes('ETIMEDOUT')) return true;
    if (error?.message?.includes('ERR_NETWORK')) return true;

    // 5xx server errors are retryable
    if (error?.status >= 500) return true;

    // Specific retryable status codes
    if ([408, 429, 503, 504].includes(error?.status)) return true;

    return false;
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
                                          operationName: string = 'Operation',
                                          options: Partial<RetryOptions> = {}
): Promise<T> {
    const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            logger.debug(`Executing ${operationName} (attempt ${attempt + 1}/${config.maxRetries + 1})`);
            const result = await fn();

            if (attempt > 0) {
                logger.info(`${operationName} succeeded after ${attempt} retry(ies)`);
            }

            return result;
        } catch (error) {
            lastError = error;

            // Check if error is retryable
            if (!isRetryableError(error)) {
                logger.error(`${operationName} failed with non-retryable error`, {
                    error: error?.message,
                    attempt
                });
                throw error;
            }

            // If this was the last attempt, throw
            if (attempt === config.maxRetries) {
                logger.error(`${operationName} failed after ${config.maxRetries} retries`, {
                    error: error?.message
                });
                throw error;
            }

            // Calculate delay and retry
            const delayMs = calculateBackoffDelay(attempt, config);
            logger.warn(`${operationName} failed (attempt ${attempt + 1}), retrying in ${delayMs}ms`, {
                error: error?.message,
                delayMs
            });

            await sleep(delayMs);
        }
    }

    throw lastError;
}
