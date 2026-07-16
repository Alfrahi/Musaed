# Conversation Feature

## Purpose

Manages real-time chat interactions with the local Ollama LLM, including message streaming, conversation persistence, attachments, and automatic title generation. This is the primary user-facing chat experience.

## Public API (`index.ts`)

### Stores

| Export               | Source                        | Description                                                               |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `conversation-store` | `store/conversation-store.ts` | Manages conversation list, creation, deletion, and metadata (schema v3)   |
| `message-store`      | `store/message-store.ts`      | Manages messages per conversation with batch updates (schema v1)          |
| `streaming-store`    | `store/streaming-store.ts`    | Manages streaming state (active stream, tokens, cancellation) (schema v1) |

### Hooks

| Export                   | Source                            | Description                                                       |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------- |
| `useChatActions`         | `hooks/useChatActions.ts`         | Core chat actions: send message, abort stream, manage RAG context |
| `useConversationActions` | `hooks/useConversationActions.ts` | CRUD operations on conversations                                  |
| `useAttachmentManager`   | `hooks/useAttachmentManager.ts`   | File attachment lifecycle (add, remove, validate)                 |
| `useTauriEvents`         | `hooks/useTauriEvents.ts`         | Subscribes to Tauri event listeners for streaming updates         |
| `useChatInitialization`  | `hooks/useChatInitialization.ts`  | Initializes chat state on mount                                   |
| `useAutoTitle`           | `hooks/useAutoTitle.ts`           | Generates conversation titles from first message exchange         |
| `triggerAutoTitle`       | `hooks/useAutoTitle.ts`           | Imperative trigger for title generation                           |

### Utils

| Export                      | Source                     | Description                                        |
| --------------------------- | -------------------------- | -------------------------------------------------- |
| `isDefaultTitle`            | `utils/title-generator.ts` | Checks if a title is still the default placeholder |
| `generateConversationTitle` | `utils/title-generator.ts` | Generates a human-readable title from messages     |

### Feature Manifest

| Export        | Source                | Description                                                                        |
| ------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `ChatFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions, and dependencies |

## Key Components (internal)

Components are **not** exported via `index.ts` (per DDD rules). They are used internally or mounted by the `layout` composition layer.

| Component            | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `ChatWindow`         | Main chat container — renders message list + input area  |
| `MessageBubble`      | Individual message rendering with avatar, content, stats |
| `MessageContent`     | Markdown/rich content rendering within a message         |
| `InputArea`          | Chat input with attachment preview, send/abort controls  |
| `CodeBlock`          | Syntax-highlighted code rendering                        |
| `MarkdownRenderer`   | Full markdown rendering pipeline with Mermaid support    |
| `MermaidRenderer`    | Diagram rendering via Mermaid.js                         |
| `ThinkingBlock`      | Collapsible "thinking" process display                   |
| `EmptyState`         | Shown when no messages exist in a conversation           |
| `AttachmentPreview`  | Thumbnail/preview for file attachments                   |
| `ChatWindowSkeleton` | Loading skeleton for chat window                         |

## IPC Endpoints

| Command                     | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `cmd_ollama_chat`           | Stream chat completions from Ollama      |
| `cmd_ollama_abort_chat`     | Abort an active streaming response       |
| `cmd_ollama_generate_title` | Generate a conversation title via Ollama |
| `cmd_rag_search`            | Search RAG-indexed documents for context |
| `cmd_logs_append`           | Append structured log entries            |

## State Schemas

| Store               | Version | Persistence Key                  |
| ------------------- | ------- | -------------------------------- |
| `conversationStore` | 3       | `musaed-conversation-storage-v2` |
| `messageStore`      | 1       | `musaed-message-storage-v1`      |
| `streamingStore`    | 1       | (ephemeral, not persisted)       |

## Example Usage

```tsx
import { useChatActions, useConversationActions } from '@/features/conversation';

function ChatPage() {
  const { sendMessage, abortStream } = useChatActions();
  const { createConversation } = useConversationActions();

  // Create a new conversation and send a message
  const handleStart = async () => {
    await createConversation();
    await sendMessage('Hello, what can you do?');
  };

  return <button onClick={handleStart}>Start chatting</button>;
}
```

## Related Docs

- [Migration Framework](../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../docs/tauri-ipc-enforcement.md)
- [Structured Logging](../../../docs/structured-logging.md)
