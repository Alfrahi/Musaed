import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModalLayout from './ModalLayout';

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
});
