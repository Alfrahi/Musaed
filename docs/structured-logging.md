# Structured Logging System

Production-grade structured logging system with trace context propagation across IPC boundaries. Implements the observability model from STANDARDS.md §14.

## Architecture

```
┌──────────────────────────┐     ┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Frontend (TypeScript)   │ → │  IPC Layer  │ → │  Rust Commands   │ → │  File + Console │
│  logger.ts / ipc/trace.ts│     │  ipc.ts     │     │  logging/        │     │  Logs         │
└──────────────────────────┘     └─────────────┘     └──────────────────┘     └──────────────┘
```

## Required Log Fields

Every trace entry MUST include:

```typescript
{
  timestamp: string;      // ISO 8601 format
  traceId: string;        // UUID v4 - groups related spans
  spanId: string;         // UUID v4 - unique span identifier
  parentSpanId?: string;  // UUID v4 - for nested spans
  feature: string;        // Feature domain (e.g., "chat", "rag", "ollama")
  action: string;         // Action name (e.g., "sendMessage", "indexProject")
  level: LogLevel;        // DEBUG | INFO | WARN | ERROR
  status?: TraceStatus;   // success | error | cancelled | timeout
  latencyMs?: number;     // Operation duration in milliseconds
  message: string;        // Human-readable description
  source: Source;         // frontend | backend | ipc
  context?: Record<string, unknown>; // Optional metadata
}
```

## Frontend Usage

### Trace API (span lifecycle)

The frontend trace API lives in `apps/web/src/lib/ipc/trace.ts` and exposes four IPC-backed operations:

```typescript
import { traceApi } from '@/lib/ipc/trace';

// Start a span and register it for context propagation
const context = await traceApi.start(traceId, 'chat', 'sendMessage');

// Complete the span with a status
await traceApi.complete(traceId, 'success', 'Message sent', { messageId: 'msg-123' });

// Retrieve the current context for an active trace
const ctx = await traceApi.getContext(traceId);
```

`traceApi` methods:

| Method       | Signature                                       | Purpose                                         |
| ------------ | ----------------------------------------------- | ----------------------------------------------- |
| `append`     | `append(input: TraceEntryInput)`                | Append a complete trace entry to the log stream |
| `start`      | `start(traceId, feature, action)`               | Start a span and register it for propagation    |
| `complete`   | `complete(traceId, status, message?, context?)` | Complete an active span with a status           |
| `getContext` | `getContext(traceId)`                           | Get the current context for an active trace     |

### One-Off Logging

For simple, non-span logging use the `logger` utility in `apps/web/src/lib/logger.ts`. It sanitizes messages (redacts paths/URLs via the contract's `sanitizeError`), truncates at 2048 chars, and persists to the backend log buffer when running inside Tauri:

```typescript
import { logger } from '@/lib/logger';

logger.info('Model loaded successfully', { model: 'llama3:latest', loadTimeMs: 234 });
logger.error('Indexing failed', { projectId: '123', reason: 'Database locked' });
logger.warn('...');
logger.debug('...'); // suppressed in production builds
```

### Store-Mutation Tracing

Store mutations are traced through `traceStoreMutation` in `apps/web/src/lib/store-tracing.ts`. It is throttled per `feature:action[:suffix]` key so a churning mutation does not flood the trace store:

```typescript
import { traceStoreMutation } from '@/lib/store-tracing';

traceStoreMutation({
  feature: 'conversation',
  action: 'setCurrentConversationId',
  level: 'INFO',
  message: 'Active conversation changed',
  context: { conversationId },
});
```

The streaming hot path uses `traceAppendToken(conversationId, contentLen)`, which emits a DEBUG trace entry every Nth token per conversation instead of on a pure time window.

Trace IDs are generated with `generateTraceId()` from `apps/web/src/lib/trace-id.ts` (UUID v4, with a deterministic fallback for environments without `crypto.randomUUID`).

## Backend Usage (Rust)

The Rust tracing domain lives in `src-tauri/src/logging/` (module `crate::logging`). It defines the types `LogLevel`, `TraceStatus`, `TraceSource`, `TraceContext`, `TraceEntry`, and `TraceEntryInput` in `mod.rs`, and the thin-adapter service functions in `service.rs`.

### Service functions

The Tauri commands (`cmd_trace_append`, `cmd_trace_start`, `cmd_trace_complete`, `cmd_trace_get_context`) delegate to the service layer:

```rust
use crate::logging::{TraceEntryInput, TraceStatus, TraceSource, LogLevel};

// Append a complete entry (frontend entry point)
let input = TraceEntryInput {
    trace_id: "550e8400-e29b-41d4-a716-446655440000".into(),
    span_id: None,
    parent_span_id: None,
    feature: "chat".into(),
    action: "sendMessage".into(),
    level: LogLevel::Info,
    status: Some(TraceStatus::Success),
    latency_ms: Some(45),
    message: "Message sent".into(),
    source: TraceSource::Frontend,
    context: None,
};
let res = crate::logging::service::append(input).await;
```

### Emitting a trace

Backend code emits a trace entry through `emit_trace`, which serializes the entry to a JSON line and writes it through the project-wide channel logger:

```rust
use crate::logging::{emit_trace, TraceEntry, LogLevel, TraceSource};

let entry = TraceEntry { /* ... */ };
emit_trace(entry);
```

### Trace context propagation

`TraceContext` carries `traceId`, `parentSpanId`, `feature`, and `action` across the IPC boundary. Active spans are registered in a global registry (`ACTIVE_SPANS`) keyed by `trace_id`, so `start`/`complete`/`get_context` can correlate spans.

## IPC Trace Propagation

The four trace commands are the single path for trace context across the IPC boundary:

- `cmd_trace_append` — append a complete entry
- `cmd_trace_start` — start a span, return its context
- `cmd_trace_complete` — complete an active span
- `cmd_trace_get_context` — read the current context for an active trace

## Validation Limits

All trace entries are validated against these constraints (see `src-tauri/src/generated_validation.rs`):

| Field            | Limit       | Description                             |
| ---------------- | ----------- | --------------------------------------- |
| `feature`        | 1-64 chars  | Feature domain name                     |
| `action`         | 1-128 chars | Action name                             |
| `message`        | 1-10 KiB    | Human-readable message                  |
| `context` fields | ≤50         | Number of key-value pairs               |
| `context` value  | ≤2 KiB      | Per-value string length                 |
| `traceId`        | ≤36 chars   | Length-checked (not strict UUID format) |

## Best Practices

### DO

✅ Use `traceApi.start`/`complete` for span lifecycle management
✅ Add contextual metadata that helps debugging
✅ Keep feature names consistent across your codebase
✅ Use `traceStoreMutation` for store churn (it is throttled for you)
✅ Complete spans in all code paths (success AND error)

### DON'T

❌ Log sensitive data (PII, credentials, tokens)
❌ Create spans without completing them
❌ Use trace logging for business logic
❌ Mix trace API with direct `logApi.append()` calls
❌ Omit the `feature` or `action` fields

## Log Output Format

Logs are written as JSON lines to the log file:

```json
{
  "timestamp": "2026-06-15T10:30:45.123Z",
  "traceId": "550e8400-e29b-41d4-a716-446655440000",
  "spanId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "feature": "chat",
  "action": "sendMessage",
  "level": "INFO",
  "status": "success",
  "latencyMs": 45,
  "message": "Message sent successfully",
  "source": "frontend",
  "context": { "messageId": "msg-123", "characterCount": 256 }
}
```

## Analysis and Querying

The structured format enables powerful analysis:

```bash
# Find all errors in chat feature
grep '"feature":"chat".*"level":"ERROR"' musaed.log

# Extract latency statistics for an action
jq 'select(.action == "sendMessage") | .latencyMs' musaed.log | stats

# Trace a specific request end-to-end
grep '"traceId":"550e8400-e29b-41d4-a716-446655440000"' musaed.log
```

## Integration with Observability

The structured logging system integrates with:

- **File-based persistence**: All traces written to `<app_data_dir>/musaed/logs/musaed.log` (resolved by `get_log_path` in `src-tauri/src/logging/logger.rs`), with rotation (`musaed.log.1`, `musaed.log.2`, …)
- **Console output**: Debug builds echo trace entries to stdout/stderr with `[TRACE:LEVEL]` prefixes
- **Trace correlation**: Parent-child spans linked via `parentSpanId`
- **Cross-IPC tracing**: Frontend → Backend → Domain modules correlated

## Error Handling

Failed trace emission never throws — errors are silently swallowed to avoid interrupting user workflows. In development, errors are logged to console.

```typescript
// This will not throw, even if IPC fails
await traceApi.append(invalidEntry);

// Development console will show:
// [logger] Tauri log persistence failed ...
```
