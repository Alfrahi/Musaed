import { callInternal } from './transport';
import type { CommandMap } from '@musaed/contracts';

/**
 * Structured Tracing API - propagates trace context across IPC boundaries.
 * Implements the observability model from STANDARDS.md §14.
 */
export const traceApi = {
  /**
   * Appends a complete trace entry to the persistent log stream.
   * @param input - Structured trace entry with all required fields
   */
  append: (input: CommandMap['cmd_trace_append']['args']['input']) =>
    callInternal('cmd_trace_append', { input }),
  /**
   * Starts a new trace span and registers it for context propagation.
   * @param traceId - Unique trace identifier (UUID v4)
   * @param feature - Feature domain (e.g., "chat", "rag", "ollama")
   * @param action - Action name (e.g., "sendMessage", "indexProject")
   * @returns Trace context for IPC propagation
   */
  start: (traceId: string, feature: string, action: string) =>
    callInternal('cmd_trace_start', { traceId, feature, action }),
  /**
   * Completes an active trace span with status.
   * @param traceId - The trace identifier
   * @param status - Completion status (success, error, cancelled, timeout)
   * @param message - Optional human-readable message
   * @param context - Optional contextual metadata
   */
  complete: (
    traceId: string,
    status: CommandMap['cmd_trace_complete']['args']['status'],
    message?: string,
    context?: Record<string, unknown>
  ) => callInternal('cmd_trace_complete', { traceId, status, message, context }),
  /**
   * Gets the current trace context for an active trace.
   * @param traceId - The trace identifier
   * @returns Trace context with current span information
   */
  getContext: (traceId: string) => callInternal('cmd_trace_get_context', { traceId }),
};
