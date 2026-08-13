# Conversation Feature

## Purpose

Manages real-time chat interactions with the local Ollama LLM, including message streaming, conversation persistence, attachments, and automatic title generation. This is the primary user-facing chat experience.

## Public API (`index.ts`)

### Hooks

| Export                          | Source                                   | Description                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useChatSend`                   | `hooks/useChatSend.ts`                   | Orchestrates sending and inline edit-and-resend: `sendMessage` validates input, composes RAG context, creates messages, and starts the stream; `editAndResend` updates a user message in-place, deletes the old assistant response, and re-streams. Calls into `useChatRag` and `useChatStream`. |
| `useConversationActions`        | `hooks/useConversationActions.ts`        | CRUD operations on conversations                                                                                                                                                                                                                                                                 |
| `useConversationInitialization` | `hooks/useConversationInitialization.ts` | Initializes conversations from Rust backend at boot                                                                                                                                                                                                                                              |
| `useAttachmentManager`          | `hooks/useAttachmentManager.ts`          | File attachment lifecycle (add, remove, validate)                                                                                                                                                                                                                                                |
| `useTauriEvents`                | `hooks/useTauriEvents.ts`                | Subscribes to Tauri event listeners for streaming updates                                                                                                                                                                                                                                        |
| `useAutoTitle`                  | `hooks/useAutoTitle.ts`                  | Generates conversation titles from first message exchange                                                                                                                                                                                                                                        |
| `triggerAutoTitle`              | `hooks/useAutoTitle.ts`                  | Imperative trigger for title generation                                                                                                                                                                                                                                                          |
| `useConversationMessages`       | `hooks/useConversationMessages.ts`       | Retrieves messages for current conversation                                                                                                                                                                                                                                                      |
| `useTokenUsage`                 | `hooks/useTokenUsage.ts`                 | Tracks token usage and context window information                                                                                                                                                                                                                                                |

### Components

| Export            | Source                           | Description                                  |
| ----------------- | -------------------------------- | -------------------------------------------- |
| `TokenContextBar` | `components/TokenContextBar.tsx` | Displays token usage and context information |

### Utils

| Export                      | Source                          | Description                                                 |
| --------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `isDefaultTitle`            | `utils/title-generator.ts`      | Checks if a title is still the default placeholder          |
| `generateConversationTitle` | `utils/title-generator.ts`      | Generates a human-readable title from messages              |
| `initializeConversations`   | `utils/conversation-backend.ts` | Loads persisted conversations from the Rust backend at boot |
| `attachmentImageSrc`        | `image-attachment.ts`           | Generates image source URL for attachments                  |

### Feature Manifest

| Export        | Source                | Description                                                                        |
| ------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `ChatFeature` | `feature.manifest.ts` | Feature manifest with public API, IPC endpoints, schema versions, and dependencies |

## Key Components (internal)

Components are **not** exported via `index.ts` (per DDD rules). They are used internally or mounted by the `layout` composition layer.

| Component            | Description                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ChatWindow`         | Main chat container — renders message list + input area                                                                              |
| `MessageBubble`      | Individual message rendering with avatar, content, stats, inline editing for user messages, and per-message delete with confirmation |
| `MessageAvatar`      | User/assistant avatar within a message bubble                                                                                        |
| `MessageContent`     | Markdown/rich content rendering within a message                                                                                     |
| `MessageStats`       | Token/speed stats display under a message                                                                                            |
| `InputArea`          | Chat input with attachment preview, send/abort controls                                                                              |
| `CodeBlock`          | Syntax-highlighted code rendering                                                                                                    |
| `MarkdownRenderer`   | Full markdown rendering pipeline with Mermaid support                                                                                |
| `MermaidRenderer`    | Diagram rendering via Mermaid.js                                                                                                     |
| `ThinkingBlock`      | Collapsible "thinking" process display                                                                                               |
| `EmptyState`         | Shown when no messages exist in a conversation                                                                                       |
| `AttachmentPreview`  | Thumbnail/preview for file attachments                                                                                               |
| `AttachmentLightbox` | Full-screen image viewer for attachments                                                                                             |
| `ChatWindowSkeleton` | Loading skeleton for chat window                                                                                                     |

## IPC Endpoints

| Command                     | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `cmd_ollama_chat`           | Stream chat completions from Ollama       |
| `cmd_ollama_abort_chat`     | Abort an active streaming response        |
| `cmd_ollama_generate_title` | Generate a conversation title via Ollama  |
| `cmd_conversation_create`   | Create a new conversation                 |
| `cmd_conversation_delete`   | Delete a conversation                     |
| `cmd_conversation_update`   | Update conversation metadata              |
| `cmd_conversation_get`      | Get conversation by ID                    |
| `cmd_conversations_clear`   | Clear all conversations                   |
| `cmd_conversations_list`    | List all conversations                    |
| `cmd_message_append`        | Append a message to conversation          |
| `cmd_message_delete`        | Delete a single message from conversation |
| `cmd_dialog_open_file`      | Open file dialog for attachments          |
| `cmd_fs_read_file`          | Read file content for attachments         |
| `cmd_fs_read_text_file`     | Read text file content                    |

## State Schemas

| Store               | Version | Persistence                                                    |
| ------------------- | ------- | -------------------------------------------------------------- |
| `conversationStore` | 4       | Persisted by the Rust backend (SQLite). No zustand persist.    |
| `messageStore`      | 0       | In-memory cache only — messages persisted by the Rust backend. |
| `streamingStore`    | —       | Fully in-memory, not persisted.                                |

> **Note:** Persistence for conversation and message stores has migrated to the Rust backend (SQLite). The state schema version `4` is enforced by both the frontend store and the Rust migration system (see `src-tauri/src/conversation/connection.rs`). `streamingStore` is intentionally absent from the manifest's `stateSchemas` — it became fully in-memory after persist middleware was removed, and versioning an unpersisted buffer would be misleading (see STANDARDS.md §9).

## Dependencies

- `library` — `InputArea` composes the library feature's `ModelSelector` component into the chat input chrome.
- `rag` — `MessageBubble` renders RAG cite affordances (`FileChunkViewer` modals) for grounded responses.

Both dependencies are declared in `feature.manifest.ts` and enforced by dep-cruiser via `generated-feature-deps.json`.

## Example Usage

```tsx
import { useChatSend, useConversationActions } from '@/features/conversation';

function ChatPage() {
  const { sendMessage, editAndResend } = useChatSend();
  const { createNewConversation } = useConversationActions();

  // Create a new conversation and send a message
  const handleStart = async () => {
    await createNewConversation();
    await sendMessage('Hello, what can you do?');
  };

  // Edit a previous user message and re-stream the response
  const handleEdit = async (msgId: string, newContent: string) => {
    await editAndResend(msgId, newContent);
  };

  return (
    <>
      <button onClick={handleStart}>Start chatting</button>
    </>
  );
}
```

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
- [Tauri IPC Enforcement](../../../../../docs/tauri-ipc-enforcement.md)
- [Structured Logging](../../../../../docs/structured-logging.md)
