import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { Toggle } from './toggle';

const setDir = (dir: 'ltr' | 'rtl') => {
  document.documentElement.setAttribute('dir', dir);
};

describe('Toggle', () => {
  beforeEach(() => setDir('ltr'));
  afterEach(() => document.documentElement.removeAttribute('dir'));

  it('renders a <button> with role="switch"', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Test" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('is locatable by accessible name via getByRole("switch", { name })', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="My Toggle" />);
    expect(screen.getByRole('switch', { name: 'My Toggle' })).toBeInTheDocument();
  });

  it('sets aria-checked to match the checked prop', () => {
    const { rerender } = render(<Toggle checked={false} onChange={vi.fn()} label="T" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    rerender(<Toggle checked={true} onChange={vi.fn()} label="T" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('links the label element to the switch via aria-labelledby', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Label me" />);
    const sw = screen.getByRole('switch');
    const labelledBy = sw.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const labelEl = document.getElementById(labelledBy!);
    expect(labelEl).not.toBeNull();
    expect(labelEl!.textContent).toBe('Label me');
  });

  it('links the description to the switch via aria-describedby', () => {
    render(
      <Toggle checked={false} onChange={vi.fn()} label="Label" description="Explains the toggle" />
    );
    const sw = screen.getByRole('switch');
    const descBy = sw.getAttribute('aria-describedby');
    expect(descBy).toBeTruthy();
    const descEl = document.getElementById(descBy!);
    expect(descEl).not.toBeNull();
    expect(descEl!.textContent).toBe('Explains the toggle');
  });

  it('omits aria-describedby when no description is provided', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="No desc" />);
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-describedby');
  });

  it('calls onChange with the inverted value on click', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="T" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('calls onChange with false when checked=true', () => {
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} label="T" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('always renders with type="button" (no accidental submit)', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="T" />);
    expect(screen.getByRole('switch')).toHaveAttribute('type', 'button');
  });

  it('forwards the ref to the underlying <button>', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Toggle ref={ref} checked={false} onChange={vi.fn()} label="T" />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="T" disabled />);
    const sw = screen.getByRole('switch');
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies the focus-ring utility class on the switch', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="T" />);
    expect(screen.getByRole('switch').className).toContain('focus-ring');
  });

  // ── Thumb position (RTL/LTR) ──────────────────────────────────────────────
  const getThumb = (): HTMLElement => {
    const sw = screen.getByRole('switch');
    const thumb = sw.querySelector('div');
    if (!thumb) throw new Error('thumb div not found');
    return thumb;
  };

  it('off state: thumb uses translate-x-0', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="T" />);
    const thumb = getThumb();
    expect(thumb.className).toMatch(/(^|\s)translate-x-0(\s|$)/);
    expect(thumb.className).not.toMatch(/ltr:translate-x-4/);
    expect(thumb.className).not.toMatch(/rtl:-translate-x-4/);
  });

  it('on state under LTR: thumb uses ltr:translate-x-4', () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="T" />);
    expect(getThumb().className).toMatch(/(^|\s)ltr:translate-x-4(\s|$)/);
  });

  it('on state under RTL: thumb uses rtl:-translate-x-4', () => {
    setDir('rtl');
    render(<Toggle checked={true} onChange={vi.fn()} label="T" />);
    expect(getThumb().className).toMatch(/(^|\s)rtl:-translate-x-4(\s|$)/);
  });

  it('on state: track has bg-blue-600', () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="T" />);
    expect(screen.getByRole('switch').className).toContain('bg-blue-600');
  });

  it('off state: track has bg-zinc-300 (not blue)', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="T" />);
    const cls = screen.getByRole('switch').className;
    expect(cls).toContain('bg-zinc-300');
    expect(cls).not.toContain('bg-blue-600');
  });
});
