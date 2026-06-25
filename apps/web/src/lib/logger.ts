'use client';

import { checkIsTauri, store, logApi } from '@/lib/ipc';
import { sanitizeError } from '@musaed/contracts';
import { config } from '@/lib/config';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

const MAX_LOG_MESSAGE_LENGTH = 2048;

/**
 * Safely serializes an object, handling circular references by omitting them.
 */
function safeSerialize(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  try {
    const seen = new WeakSet();
    const serialized = JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

/**
 * Application-wide logging utility that persists to disk and backend log buffer.
 */
export const logger = {
  /**
   * Logs a message with a specific severity level.
   */
  log: async (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (config.isProd && level === 'debug') return;

    // Use the contract's sanitization logic to redact paths and URLs
    const sanitized = sanitizeError({ message, context });
    const finalMessage =
      sanitized.message.length > MAX_LOG_MESSAGE_LENGTH
        ? sanitized.message.substring(0, MAX_LOG_MESSAGE_LENGTH) + '... [TRUNCATED]'
        : sanitized.message;

    if (!config.isProd) {
      if (level === 'error') {
        console.error(`[${level.toUpperCase()}] ${finalMessage}`, context || '');
      } else if (level === 'warn') {
        console.warn(`[${level.toUpperCase()}] ${finalMessage}`, context || '');
      }
      // info and debug levels are not printed to console per lint rules
    }

    const entry: LogEntry = {
      level,
      message: finalMessage,
      timestamp: new Date().toISOString(),
      context: context ? safeSerialize(context) : undefined,
    };

    const logString = JSON.stringify(entry);

    if (checkIsTauri()) {
      try {
        const logStore = await store.load('logs.json', { autoSave: true });
        if (logStore) {
          const logs = (await logStore.get<string[]>('entries')) || [];
          const updatedLogs = [...logs, logString].slice(-1000);
          await logStore.set('entries', updatedLogs);
          await logStore.save();
        }
        await logApi.append(logString);
      } catch (err) {
        if (!config.isProd) {
          console.error('[logger] Tauri log persistence failed', err);
        } else {
          console.error('[logger] persistence failed');
        }
      }
    }
  },

  info: (message: string, context?: Record<string, unknown>) => {
    logger.log('info', message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    logger.log('warn', message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    logger.log('error', message, context);
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    logger.log('debug', message, context);
  },
};
