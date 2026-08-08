'use client';

import { useCallback, useRef } from 'react';

// Type-ahead reset delay in ms. Per WAI-ARIA combobox pattern, resets the
// first-letter search accumulator after a brief typing pause.
export const TYPE_AHEAD_RESET_MS = 500;

/** Pure next-index helper for ArrowUp/ArrowDown in the combobox. */
export function nextActiveIndex(prev: number, delta: number, length: number): number {
  if (length === 0) return -1;
  const base = prev < 0 ? (delta > 0 ? -1 : length) : prev;
  return (base + delta + length) % length;
}

/**
 * Fire-and-forget type-ahead accumulator. Reads/writes the {@link TypeAheadState}
 * ref (kept in the hook so the host's open/close effect can reset it cleanly)
 * and returns the index of the first matching option, or -1 when no match.
 */
function advanceTypeAhead(
  state: { keys: string; at: number },
  key: string,
  modelNames: string[]
): number {
  if (modelNames.length === 0) return -1;
  const now = Date.now();
  if (now - state.at > TYPE_AHEAD_RESET_MS) state.keys = '';
  state.at = now;
  const acc = (state.keys + key).slice(-4); // bound accumulator
  state.keys = acc;
  const lower = acc.toLowerCase();
  return modelNames.findIndex((n) => n.toLowerCase().startsWith(lower));
}

/**
 * Dispaches a single keydown event to the appropriate combobox action. Module-
 * level pure function so the {@link useModelSelectorKeyboard} hook stays under
 * lint's max-lines-per-function budget.
 */
function dispatchComboboxKey(
  e: React.KeyboardEvent<HTMLButtonElement>,
  handlers: {
    isOpen: boolean;
    modelCount: number;
    open: () => void;
    move: (delta: number) => void;
    jump: (index: number) => void;
    select: () => void;
    closeAndRefocus: () => void;
    close: () => void;
    typeAhead: (key: string) => void;
  }
): void {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (!handlers.isOpen) handlers.open();
      else handlers.move(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (!handlers.isOpen) handlers.open();
      else handlers.move(-1);
      break;
    case 'Home':
      e.preventDefault();
      if (!handlers.isOpen) handlers.open();
      else handlers.jump(0);
      break;
    case 'End':
      e.preventDefault();
      if (!handlers.isOpen) handlers.open();
      else handlers.jump(handlers.modelCount - 1);
      break;
    case 'Enter':
      e.preventDefault();
      if (handlers.isOpen) handlers.select();
      break;
    case 'Escape':
      // WAI-ARIA combobox: Escape closes the listbox and returns focus to the
      // trigger so keyboard users do not lose their place in the tab order.
      if (handlers.isOpen) {
        e.preventDefault();
        handlers.closeAndRefocus();
      }
      break;
    case 'Tab':
      // Closing on Tab-out mirrors native combobox behavior and keeps
      // outside-click-close consistent with keyboard-driven exits.
      if (handlers.isOpen) handlers.close();
      break;
    default:
      if (e.key.length === 1 && /[^\s]/.test(e.key)) {
        if (!handlers.isOpen) handlers.open();
        handlers.typeAhead(e.key);
      }
      break;
  }
}

/**
 * Encapsulates the keyboard + type-ahead handlers for the {@link ModelSelector}
 * WAI-ARIA combobox. Factored into a hook so the trigger component stays under
 * lint's max-lines-per-function budget without losing behaviour.
 *
 * @param modelNames       the full list of option labels in display order
 * @param isOpen           current listbox visibility (read-only)
 * @param activeIndex      current active option index (read-only)
 * @param setActiveIndex   setter used by Arrow/Home/End/type-ahead
 * @param setIsOpen        setter used to open/close the listbox
 * @param setSelectedModel store action invoked on Enter
 * @param triggerRef       ref to the combobox trigger, refocused on Escape
 */
export function useModelSelectorKeyboard({
  modelNames,
  isOpen,
  activeIndex,
  setActiveIndex,
  setIsOpen,
  setSelectedModel,
  triggerRef,
}: {
  modelNames: string[];
  isOpen: boolean;
  activeIndex: number;
  setActiveIndex: (next: number | ((prev: number) => number)) => void;
  setIsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setSelectedModel: (name: string) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const typeAheadRef = useRef<{ keys: string; at: number }>({ keys: '', at: 0 });

  const moveActive = useCallback(
    (delta: number) => {
      if (modelNames.length === 0) return;
      setActiveIndex((prev) => nextActiveIndex(prev, delta, modelNames.length));
    },
    [modelNames.length, setActiveIndex]
  );

  const jumpActive = useCallback(
    (index: number) => {
      if (modelNames.length === 0) return;
      setActiveIndex(Math.max(0, Math.min(index, modelNames.length - 1)));
    },
    [modelNames.length, setActiveIndex]
  );

  const selectActive = useCallback(() => {
    if (modelNames.length === 0) return;
    const idx = activeIndex >= 0 ? activeIndex : 0;
    const name = modelNames[idx];
    if (name) {
      setSelectedModel(name);
      setIsOpen(false);
    }
  }, [activeIndex, modelNames, setSelectedModel, setIsOpen]);

  const handleTypeAhead = useCallback(
    (key: string) => {
      const matched = advanceTypeAhead(typeAheadRef.current, key, modelNames);
      if (matched >= 0) setActiveIndex(matched);
    },
    [modelNames, setActiveIndex]
  );

  const closeAndRefocus = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, [setIsOpen, triggerRef]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) =>
      dispatchComboboxKey(e, {
        isOpen,
        modelCount: modelNames.length,
        open: () => setIsOpen(true),
        move: moveActive,
        jump: jumpActive,
        select: selectActive,
        closeAndRefocus,
        close: () => setIsOpen(false),
        typeAhead: handleTypeAhead,
      }),
    [
      isOpen,
      modelNames.length,
      moveActive,
      jumpActive,
      selectActive,
      handleTypeAhead,
      closeAndRefocus,
      setIsOpen,
    ]
  );

  // reason: the open/close effect in the host component needs to reset the
  // type-ahead accumulator when the listbox closes; expose the ref so that
  // reset is non-redundant with hook-owned state.
  return { handleTriggerKeyDown, typeAheadRef };
}
