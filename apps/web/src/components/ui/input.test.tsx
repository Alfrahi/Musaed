import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Input, Textarea } from './input';

describe('Input', () => {
  it('renders an <input> element by default', () => {
    render(<Input aria-label="search" />);
    expect(screen.getByRole('textbox', { name: 'search' })).toBeInTheDocument();
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('honors explicit type="search"', () => {
    render(<Input type="search" aria-label="filter" />);
    expect(screen.getByRole('searchbox', { name: 'filter' })).toBeInTheDocument();
  });

  it('forwards the ref to the underlying <input>', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="x" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('spreads arbitrary input attributes', () => {
    const onChange = vi.fn();
    render(
      <Input
        id="foo"
        value="bar"
        onChange={onChange}
        placeholder="baz"
        aria-label="x"
        autoComplete="off"
      />
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('id', 'foo');
    expect(input).toHaveAttribute('value', 'bar');
    expect(input).toHaveAttribute('placeholder', 'baz');
    expect(input).toHaveAttribute('autoComplete', 'off');
  });

  it('applies the canonical baseline classes', () => {
    render(<Input aria-label="x" />);
    const cls = screen.getByRole('textbox').className;
    // radius
    expect(cls).toContain('rounded-md');
    // padding
    expect(cls).toContain('py-2');
    expect(cls).toContain('px-3');
    // font size
    expect(cls).toContain('text-sm');
    // border
    expect(cls).toContain('border-zinc-200');
    expect(cls).toContain('dark:border-zinc-700');
    // background
    expect(cls).toContain('bg-white');
    expect(cls).toContain('dark:bg-zinc-900');
    // transition
    expect(cls).toContain('transition-all');
    expect(cls).toContain('duration-150');
    // focus ring
    expect(cls).toContain('focus-ring');
  });

  it('lets caller className override defaults via tailwind-merge', () => {
    render(<Input className="bg-zinc-100 dark:bg-zinc-800" aria-label="x" />);
    const cls = screen.getByRole('textbox').className;
    expect(cls).toContain('bg-zinc-100');
    expect(cls).toContain('dark:bg-zinc-800');
    expect(cls).not.toContain('bg-white');
  });
});

describe('Textarea', () => {
  it('renders a <textarea> element', () => {
    render(<Textarea aria-label="prompt" />);
    expect(screen.getByRole('textbox', { name: 'prompt' })).toBeInTheDocument();
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('forwards the ref to the underlying <textarea>', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="x" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current?.tagName).toBe('TEXTAREA');
  });

  it('spreads arbitrary textarea attributes (rows, maxLength, disabled)', () => {
    render(<Textarea rows={4} maxLength={100} disabled aria-label="x" />);
    const ta = screen.getByRole('textbox');
    expect(ta).toHaveAttribute('rows', '4');
    expect(ta).toHaveAttribute('maxlength', '100');
    expect(ta).toBeDisabled();
  });

  it('applies the same canonical baseline classes as Input', () => {
    render(<Textarea aria-label="x" />);
    const cls = screen.getByRole('textbox').className;
    expect(cls).toContain('rounded-md');
    expect(cls).toContain('py-2');
    expect(cls).toContain('px-3');
    expect(cls).toContain('text-sm');
    expect(cls).toContain('border-zinc-200');
    expect(cls).toContain('dark:border-zinc-700');
    expect(cls).toContain('bg-white');
    expect(cls).toContain('dark:bg-zinc-900');
    expect(cls).toContain('transition-all');
    expect(cls).toContain('duration-150');
    expect(cls).toContain('focus-ring');
  });

  it('lets caller className add resize / sizing overrides', () => {
    render(<Textarea className="min-h-[100px] resize-none" aria-label="x" />);
    const cls = screen.getByRole('textbox').className;
    expect(cls).toContain('resize-none');
    expect(cls).toContain('min-h-[100px]');
  });
});
