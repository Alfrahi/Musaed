/**
 * One-shot cross-component signal for the "Edit prompt" / "Edit" actions
 * (Prompt 14). ChatWindow writes to the signal when the user clicks Edit on
 * a message bubble; useChatInput subscribes and populates the textarea.
 *
 * Replaces the former `chat-input-store` Zustand store — this is ephemeral
 * UI coordination that belongs in the conversation feature, not in the
 * global store layer (STANDARDS.md §9, §22).
 */

type Listener = (prompt: string) => void;

let currentListener: Listener | null = null;

/** Set the edit-prompt value. Notifies the subscribed reader (useChatInput). */
export function fireEditPrompt(prompt: string): void {
  currentListener?.(prompt);
}

/** Subscribe to edit-prompt signals. Returns an unsubscribe function. */
export function subscribeEditPrompt(listener: Listener): () => void {
  currentListener = listener;
  return () => {
    if (currentListener === listener) {
      currentListener = null;
    }
  };
}
