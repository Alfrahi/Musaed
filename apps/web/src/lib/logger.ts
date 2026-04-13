"use client";

import { checkIsTauri, store, invoke } from './ipc';
import { sanitizeError } from '@musaed/contracts';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, any>;
}

const isProd = process.env.NODE_ENV === 'production';
const MAX_LOG_MESSAGE_LENGTH = 2048;

export const logger = {
  log: async (level: LogLevel, message: string, context?: Record<string, any>) => {
    if (isProd && level === 'debug') return;

    // Use the contract's sanitization logic to redact paths and URLs
    const sanitized = sanitizeError({ message, context });
    const finalMessage = sanitized.message.length > MAX_LOG_MESSAGE_LENGTH 
      ? sanitized.message.substring(0, MAX_LOG_MESSAGE_LENGTH) + "... [TRUNCATED]" 
      : sanitized.message;

    if (!isProd) {
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[${level.toUpperCase()}] ${finalMessage}`, context || '');
    }

    const entry: LogEntry = {
      level,
      message: finalMessage,
      timestamp: new Date().toISOString(),
      context: context ? JSON.parse(JSON.stringify(context)) : undefined, // Shallow clone
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
        await invoke('append_to_log', { entry: logString });
      } catch (err) {
        if (!isProd) {
          console.error('[logger] Tauri log persistence failed', err);
        } else {
          console.error('[logger] persistence failed');
        }
      }
    }
  },
  
  info: (message: string, context?: Record<string, any>) => { logger.log('info', message, context); },
  warn: (message: string, context?: Record<string, any>) => { logger.log('warn', message, context); },
  error: (message: string, context?: Record<string, any>) => { logger.log('error', message, context); },
  debug: (message: string, context?: Record<string, any>) => { logger.log('debug', message, context); },
};