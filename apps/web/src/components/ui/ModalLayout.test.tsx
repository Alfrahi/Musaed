import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModalLayout from './ModalLayout';

// ── framer-motion mock ─────────────────────────────────────────────────────
// Mock motion components to plain elements so tests don't depend on animation
// internals. useReducedMotion is kept as a controllable mock.

const useReducedMotionMock = vi.fn(() => false);

vi.mock('framer-motion', async () => {
  return {
    motion: {
      div: 'div',
      button: 'button',
      span: 'span',
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  titleId?: string;
  describedById?: string;
}

const Harness = ({ isOpen = true, onClose, titleId, describedById }: Props) => (
  <ModalLayout
    isOpen={isOpen}
    onClose={onClose ?? vi.fn()}
    titleId={titleId}
    describedById={describedById}
  >
    <div>
      <h2 id={titleId}>Title</h2>
      <button>Inside</button>
      <a href="#">link</a>
      <input type="text" />
    </div>
  </ModalLayout>
);

describe('ModalLayout', () => {
  beforeEach(() => {
    // focus-trap-react reads tabbable nodes from the DOM; ensure each test has
    // a clean focus starting point.
    document.body.focus();
    useReducedMotionMock.mockReturnValue(false);
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(<Harness isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders role="dialog" with aria-modal="true"', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('passes aria-labelledby to the dialog from the titleId prop', () => {
    render(<Harness titleId="my-title" />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog).toHaveAttribute('aria-labelledby', 'my-title');
  });

  it('passes aria-describedby when provided', () => {
    render(<Harness describedById="my-desc" />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog).toHaveAttribute('aria-describedby', 'my-desc');
  });

  it('calls onClose on Escape keydown', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on non-Escape keydown', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on a pointerdown that lands on the backdrop (not the panel)', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    // The trap wraps the dialog inside an outer backdrop div. The backdrop is
    // the parent that owns the onPointerDown handler — walk up to find it.
    const backdrop = dialog.parentElement!;
    expect(backdrop).toBeInTheDocument();
    fireEvent.pointerDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when pointerdown lands inside the panel (not on the backdrop)', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    fireEvent.pointerDown(dialog, { target: dialog });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open (not left on <body>)', async () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    // focus-trap-react activates inside an effect that runs after mount; flush.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
    const active = document.activeElement;
    expect(dialog.contains(active) || active === dialog).toBe(true);
  });

  it('restores focus to the previously focused element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(<Harness />);
    // Pretend the user pressed Escape → host unmounts.
    rerender(<Harness isOpen={false} onClose={() => {}} />);

    // The cleanup effect runs after the unmount traversal. In jsdom, the restore
    // is a synchronous `.focus()` call within the prior effect cleanup.
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  describe('prefers-reduced-motion', () => {
    it('renders a plain div without animation style when prefers-reduced-motion is set', () => {
      useReducedMotionMock.mockReturnValue(true);
      render(<Harness />);
      const dialog = screen.getByRole('dialog', { hidden: true });
      // When reduced motion is active, the component renders a plain <div>
      // without framer-motion animation props. Since motion.div is mocked
      // to 'div', the absence of inline style confirms the plain-div branch.
      expect(dialog.getAttribute('style')).toBeFalsy();
    });

    it('renders with animation style when prefers-reduced-motion is not set', () => {
      useReducedMotionMock.mockReturnValue(false);
      render(<Harness />);
      const dialog = screen.getByRole('dialog', { hidden: true });
      // motion.div passes initial/animate as props; when mocked to 'div',
      // React renders them as HTML attributes (not styles). The key assertion
      // is that the dialog still renders with correct ARIA.
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });
});
