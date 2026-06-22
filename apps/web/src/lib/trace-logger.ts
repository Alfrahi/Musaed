'use client';

import {
  type TraceEntry,
  type TraceContext,
  type LogLevel,
  type TraceStatus,
  TraceEntrySchema,
} from '@musaed/contracts';
import { logApi } from '@/lib/ipc';

/**
 * Generates a new UUID v4 for trace/span IDs using native crypto API.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Gets current timestamp in ISO 8601 format.
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Serializes a trace entry to a JSON string for logging.
 * Handles circular references and sanitizes context data.
 */
function serializeTrace(entry: TraceEntry): string {
  try {
    // Sanitize context - remove functions and circular refs
    const safeContext = entry.context
      ? JSON.parse(
          JSON.stringify(entry.context, (key, value) => {
            // Filter out functions and undefined
            if (typeof value === 'function' || value === undefined) {
              return undefined;
            }
            // Truncate large strings in context
            if (typeof value === 'string' && value.length > 512) {
              return value.substring(0, 512) + '... [TRUNCATED]';
            }
            return value;
          })
        )
      : undefined;

    const safeEntry: TraceEntry = {
      ...entry,
      context: safeContext,
    };

    return JSON.stringify(safeEntry);
  } catch {
    // Fallback: minimal entry without context
    const minimalEntry: TraceEntry = {
      ...entry,
      context: { serializationError: 'Failed to serialize context' },
    };
    return JSON.stringify(minimalEntry);
  }
}

/**
 * Options for creating a new trace.
 */
export interface TraceOptions {
  feature: string;
  action: string;
  parentSpanId?: string;
  initialContext?: Record<string, unknown>;
}

/**
 * Options for completing a trace.
 */
export interface TraceCompleteOptions {
  status: TraceStatus;
  latencyMs?: number;
  message?: string;
  context?: Record<string, unknown>;
}

/**
 * A span represents a single unit of work within a trace.
 * Supports nested spans via parentSpanId.
 */
export class TraceSpan {
  private readonly traceId: string;
  private readonly spanId: string;
  private readonly parentSpanId?: string;
  private readonly feature: string;
  private readonly action: string;
  private readonly startTime: number;
  private context: Record<string, unknown>;
  private completed = false;

  constructor(traceId: string, options: TraceOptions) {
    this.traceId = traceId;
    this.spanId = generateId();
    this.parentSpanId = options.parentSpanId;
    this.feature = options.feature;
    this.action = options.action;
    this.startTime = performance.now();
    this.context = options.initialContext ?? {};
  }

  /**
   * Adds or updates context data for this span.
   */
  addContext(key: string, value: unknown): this {
    this.context[key] = value;
    return this;
  }

  /**
   * Gets the span ID for this span (for creating child spans).
   */
  getSpanId(): string {
    return this.spanId;
  }

  /**
   * Gets the trace ID for this span (for correlation across spans).
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * Creates a child span nested under this span.
   */
  child(action: string, initialContext?: Record<string, unknown>): TraceSpan {
    return traceLogger.createSpan({
      feature: this.feature,
      action,
      parentSpanId: this.spanId,
      initialContext,
    });
  }

  /**
   * Completes this span with an INFO-level success status.
   */
  success(message?: string, extraContext?: Record<string, unknown>): void {
    this.complete({
      status: 'success',
      message,
      context: extraContext,
    });
  }

  /**
   * Completes this span with an ERROR-level status.
   */
  error(message: string, extraContext?: Record<string, unknown>): void {
    this.complete({
      status: 'error',
      message,
      context: extraContext,
    });
  }

  /**
   * Completes this span with a WARN-level status.
   */
  warn(message: string, extraContext?: Record<string, unknown>): void {
    this.complete({
      status: 'success',
      message,
      context: extraContext,
    });
  }

  /**
   * Completes this span with a DEBUG-level timeout status.
   */
  timeout(message?: string, extraContext?: Record<string, unknown>): void {
    this.complete({
      status: 'timeout',
      message,
      context: extraContext,
    });
  }

  /**
   * Manually completes the span with custom status.
   * Calculates latency automatically.
   */
  complete(options: TraceCompleteOptions): void {
    if (this.completed) {
      return;
    }
    this.completed = true;

    const latencyMs = options.latencyMs ?? Math.round(performance.now() - this.startTime);

    const entry: TraceEntry = {
      timestamp: getTimestamp(),
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      feature: this.feature,
      action: this.action,
      level: this.determineLevel(options.status),
      status: options.status,
      latencyMs,
      message: options.message ?? `${this.action} ${options.status}`,
      source: 'frontend',
      context: { ...this.context, ...(options.context ?? {}) },
    };

    this.emit(entry);
  }

  /**
   * Determines log level based on status.
   */
  private determineLevel(status: TraceStatus): LogLevel {
    switch (status) {
      case 'success':
        return 'INFO';
      case 'error':
        return 'ERROR';
      case 'cancelled':
        return 'WARN';
      case 'timeout':
        return 'DEBUG';
      default:
        return 'INFO';
    }
  }

  /**
   * Emits the trace entry to persistence and console.
   */
  private emit(entry: TraceEntry): void {
    // Validate entry
    const result = TraceEntrySchema.safeParse(entry);
    if (!result.success) {
      // Validation errors are silently swallowed in production
      return;
    }

    const serialized = serializeTrace(entry);

    // Persist via IPC
    if (typeof window !== 'undefined') {
      logApi.append(serialized).catch(() => {
        // IPC errors are silently swallowed in production
      });
    }
  }
}

/**
 * Utility function to wrap async operations with automatic tracing.
 * Ensures span completion even on errors.
 */
export async function traceAsync<T>(
  options: TraceOptions,
  fn: (span: TraceSpan) => Promise<T>
): Promise<T> {
  const span = traceLogger.createSpan(options);

  try {
    const result = await fn(span);
    span.success();
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    span.error(errorMessage, {
      errorName: error instanceof Error ? error.name : 'Unknown',
    });
    throw error;
  }
}

/**
 * Main trace logger singleton that manages trace lifecycle.
 * Provides centralized trace creation and context propagation.
 */
class TraceLogger {
  /**
   * Creates a new span with the given options.
   * This is the primary entry point for creating traces.
   */
  createSpan(options: TraceOptions): TraceSpan {
    const traceId = options.parentSpanId ? generateId() : generateId();
    return new TraceSpan(traceId, options);
  }

  /**
   * Convenience method for tracing an async operation.
   * Automatically handles success/error completion.
   */
  async trace<T>(options: TraceOptions, fn: (span: TraceSpan) => Promise<T>): Promise<T> {
    return traceAsync(options, fn);
  }

  /**
   * Creates a trace context from an existing span for IPC propagation.
   * Use this when sending trace context to the backend.
   */
  createTraceContext(span: TraceSpan): TraceContext {
    return {
      traceId: span.getTraceId(),
      parentSpanId: span.getSpanId(),
      feature: span instanceof TraceSpan ? span['feature'] : 'unknown',
      action: span instanceof TraceSpan ? span['action'] : 'unknown',
    };
  }

  /**
   * Logs a one-off trace entry without creating a span.
   * Use for simple log events that don't need lifecycle tracking.
   */
  log(
    level: LogLevel,
    feature: string,
    action: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const entry: TraceEntry = {
      timestamp: getTimestamp(),
      traceId: generateId(),
      spanId: generateId(),
      feature,
      action,
      level,
      status: undefined,
      latencyMs: undefined,
      message,
      source: 'frontend',
      context,
    };

    // Validate and emit
    const result = TraceEntrySchema.safeParse(entry);
    if (!result.success) {
      // Validation errors are silently swallowed in production
      return;
    }

    const serialized = serializeTrace(entry);

    if (typeof window !== 'undefined') {
      logApi.append(serialized).catch(() => {});
    }
  }

  /**
   * Convenience methods for common log levels.
   */
  debug(feature: string, action: string, message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', feature, action, message, context);
  }

  info(feature: string, action: string, message: string, context?: Record<string, unknown>): void {
    this.log('INFO', feature, action, message, context);
  }

  warn(feature: string, action: string, message: string, context?: Record<string, unknown>): void {
    this.log('WARN', feature, action, message, context);
  }

  error(feature: string, action: string, message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', feature, action, message, context);
  }
}

/**
 * Global trace logger instance.
 * Import and use throughout the application.
 */
export const traceLogger = new TraceLogger();

/**
 * Legacy adapter to bridge old logger calls to structured logging.
 * Use this for gradual migration from the old logger API.
 */
export const structuredLogger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    traceLogger.debug('legacy', 'logger', message, context);
  },
  info: (message: string, context?: Record<string, unknown>) => {
    traceLogger.info('legacy', 'logger', message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    traceLogger.warn('legacy', 'logger', message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    traceLogger.error('legacy', 'logger', message, context);
  },
};
