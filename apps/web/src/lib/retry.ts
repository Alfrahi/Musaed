"use client";

import { logger } from './logger';

export interface RetryOptions {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterFactor: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
};

export function calculateBackoffDelay(
    attempt: number,
    options: RetryOptions
): number {
    const exponentialDelay = Math.min(
        options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt),
        options.maxDelayMs
    );
    const jitter = exponentialDelay * options.jitterFactor * Math.random();
    return exponentialDelay + jitter;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function isRetryableError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes('timeout') ||
           msg.includes('ECONNREFUSED') ||
           msg.includes('ECONNRESET') ||
           msg.includes('ETIMEDOUT') ||
           msg.includes('ERR_NETWORK');
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    operationName: string = 'Operation',
    options: Partial<RetryOptions> = {}
): Promise<T> {
    const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            const result = await fn();
            if (attempt > 0) {
                logger.info(`${operationName} succeeded after ${attempt} retry(ies)`);
            }
            return result;
        } catch (error: unknown) {
            lastError = error;

            if (!isRetryableError(error)) {
                logger.error(`${operationName} failed with non-retryable error`, {
                    error: error instanceof Error ? error.message : String(error),
                    attempt
                });
                throw error;
            }

            if (attempt === config.maxRetries) {
                logger.error(`${operationName} failed after ${config.maxRetries} retries`, {
                    error: error instanceof Error ? error.message : String(error)
                });
                throw error;
            }

            const delayMs = calculateBackoffDelay(attempt, config);
            logger.warn(`${operationName} failed (attempt ${attempt + 1}), retrying in ${delayMs}ms`, {
                error: error instanceof Error ? error.message : String(error),
                delayMs
            });

            await sleep(delayMs);
        }
    }

    throw lastError;
}