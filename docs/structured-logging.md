# Structured Logging System

Production-grade structured logging system with trace context propagation across IPC boundaries. Implements the observability model from STANDARDS.md §14.

## Architecture

```
┌─────────────────────┐     ┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Frontend (TypeScript) │ → │  IPC Layer  │ → │  Rust Commands   │ → │  File + Console │
│  traceLogger.ts   │     │  ipc.ts     │     │  tracing/        │     │  Logs         │
└─────────────────────┘     └─────────────┘     └──────────────────┘     └──────────────┘
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

### Basic Trace Span

```typescript
import { traceLogger } from '@/lib/trace-logger';

// Create a span for an operation
const span = traceLogger.createSpan({
  feature: 'chat',
  action: 'sendMessage',
});

try {
  // Your operation here
  await sendMessage(message);

  // Complete with success
  span.success('Message sent successfully', {
    messageId: message.id,
    characterCount: message.content.length,
  });
} catch (error) {
  // Complete with error
  span.error('Failed to send message', {
    errorName: error instanceof Error ? error.name : 'Unknown',
  });
  throw error;
}
```

### Async Helper (Recommended)

```typescript
import { traceAsync, traceLogger } from '@/lib/trace-logger';

// Automatically handles span lifecycle
const result = await traceAsync(
  {
    feature: 'rag',
    action: 'searchProject',
    initialContext: { projectId, query },
  },
  async (span) => {
    // Your async operation
    const searchResults = await ragApi.search(projectId, query);

    // Add context mid-operation
    span.addContext('resultCount', searchResults.length);

    return searchResults;
  }
);
```

### Nested Spans

```typescript
import { traceLogger } from '@/lib/trace-logger';

const parentSpan = traceLogger.createSpan({
  feature: 'ollama',
  action: 'chatCompletion',
});

// Create child span
const childSpan = parentSpan.child('validateModel');

// Child span automatically gets parentSpanId for correlation
await validateModel(modelName);
childSpan.success();

parentSpan.success('Chat completion finished');
```

### One-Off Logging

```typescript
import { traceLogger } from '@/lib/trace-logger';

// Simple log without span lifecycle
traceLogger.info('chat', 'modelLoaded', 'Model loaded successfully', {
  model: 'llama3:latest',
  loadTimeMs: 234,
});

traceLogger.error('rag', 'indexingFailed', 'Indexing failed', {
  projectId: '123',
  reason: 'Database locked',
});
```

### Legacy Adapter

For gradual migration from the old logger API:

```typescript
import { structuredLogger } from '@/lib/trace-logger';

// Old API calls now route through structured logging
structuredLogger.info('User clicked send button', { conversationId: '123' });
structuredLogger.error('Network error', { url: '[REDACTED]' });
```

## Backend Usage (Rust)

### Basic Span

```rust
use crate::tracing::{Span, TraceStatus};
use uuid::Uuid;

let trace_id = Uuid::new_v4().to_string();
let span = Span::new(
    trace_id,
    "chat".to_string(),
    "sendMessage".to_string(),
    None, // parent_span_id
);

// Your operation
match send_message(&message).await {
    Ok(_) => {
        span.success(Some("Message sent".to_string()), None);
    }
    Err(e) => {
        span.error(format!("Failed: {}", e), None);
    }
}
```

### Trace Context Propagation

```rust
use crate::tracing::{Span, TraceContext};

// When receiving a trace context from frontend
fn handle_request(ctx: TraceContext) {
    let span = Span::new(
        ctx.trace_id,
        ctx.feature,
        ctx.action,
        ctx.parent_span_id, // Link to parent span
    );

    // Operation with correlated tracing
    process_request();
    span.success(None, None);
}
```

### Using the Macro

```rust
// Wrap async operations with automatic span lifecycle
let result = trace_async!(
    "rag",
    "indexProject",
    { index_project(&project).await },
    |result| match result {
        Ok(_) => Some("Indexing completed".to_string()),
        Err(_) => Some("Indexing failed".to_string()),
    }
);
```

## IPC Trace Propagation

When making IPC calls that should be correlated:

```typescript
import { traceLogger, traceAsync } from '@/lib/trace-logger';
import { ragApi } from '@/lib/ipc';

await traceAsync(
  {
    feature: 'rag',
    action: 'indexProject',
  },
  async (span) => {
    // The IPC call will be correlated via trace context
    const context = traceLogger.createTraceContext(span);

    // Pass context implicitly via the span
    await ragApi.indexProject(projectId);

    span.addContext('indexedFiles', fileCount);
  }
);
```

## Validation Limits

All trace entries are validated against these constraints:

| Field            | Limit       | Description               |
| ---------------- | ----------- | ------------------------- |
| `feature`        | 1-64 chars  | Feature domain name       |
| `action`         | 1-128 chars | Action name               |
| `message`        | 1-10 KiB    | Human-readable message    |
| `context` fields | ≤50         | Number of key-value pairs |
| `context` value  | ≤2 KiB      | Per-value string length   |
| `traceId`        | UUID v4     | Must be valid UUID format |
| `spanId`         | UUID v4     | Must be valid UUID format |

## Best Practices

### DO

✅ Use `traceAsync` for automatic span lifecycle management  
✅ Add contextual metadata that helps debugging  
✅ Keep feature names consistent across your codebase  
✅ Use child spans for nested operations  
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

- **File-based persistence**: All traces written to `musaed/logs/musaed.log`
- **Console output**: Development mode shows colored trace logs
- **Trace correlation**: Parent-child spans linked via `parentSpanId`
- **Cross-IPC tracing**: Frontend → Backend → Domain modules correlated

## Error Handling

Failed trace emission never throws - errors are silently swallowed in production to avoid interrupting user workflows. In development, errors are logged to console.

```typescript
// This will not throw, even if IPC fails
await traceApi.append(invalidEntry);

// Development console will show:
// [TraceLogger] Invalid trace entry: ZodError...
```
