# Chat Feature

Provides the main conversation interface, message rendering (including Markdown, LaTeX, and Mermaid), and attachment management.

## Components
- `ChatWindow`: Main container for messages and input.
- `MessageBubble`: Individual message display.
- `MermaidRenderer`: Preprocesses and renders Mermaid diagrams with error recovery.
- `MarkdownRenderer`: Renders markdown content using unified/remark.
- `InputArea`: Message input component with attachment support.

## Hooks
- `useChatActions`: Handles sending and receiving messages.
- `useAttachmentManager`: Manages file and image uploads.
- `useConversationActions`: Logic for creating, deleting, and renaming conversations.

## Utilities
- `mermaid-utils.ts`: Preprocessing and validation logic for Mermaid diagrams.
