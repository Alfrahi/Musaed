import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('renders a <button> element', () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('defaults to type="button" (not submit)', () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('preserves an explicit type="submit" override', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('forwards the ref to the underlying <button>', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Send</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('spreads arbitrary button attributes (onClick, disabled, aria-label)', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled aria-label="send message">
        <svg data-testid="icon" />
      </Button>
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-label', 'send message');
    expect(btn).toBeDisabled();
    btn.click();
    // disabled buttons do not fire their onClick handler in the browser, and
    // jsdom mirrors that — so onClick should NOT have been called.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the default (primary / md) variant classes', () => {
    render(<Button>Send</Button>);
    const btn = screen.getByRole('button');
    // Primary: solid blue background token from @theme.
    expect(btn.className).toContain('bg-blue-600');
    // Md: explicit height + horizontal padding (px-4 / h-10).
    expect(btn.className).toContain('h-10');
    expect(btn.className).toContain('px-4');
  });

  it.each([
    ['primary', 'bg-blue-600'],
    ['secondary', 'bg-zinc-900'],
    ['ghost', 'hover:bg-zinc-100'],
    ['outline', 'border-zinc-200'],
    ['danger', 'bg-red-500'],
  ] as const)('applies a distinctive class for variant=%s', (variant, expected) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button').className).toContain(expected);
  });

  it.each([
    ['sm', 'h-8'],
    ['md', 'h-10'],
    ['lg', 'h-12'],
    ['icon', 'w-8'],
  ] as const)('applies a distinctive class for size=%s', (size, expected) => {
    render(<Button size={size}>x</Button>);
    expect(screen.getByRole('button').className).toContain(expected);
  });

  it('lets caller className override defaults via tailwind-merge', () => {
    // tailwind-merge: a later `bg-red-500` should override the primary
    // `bg-blue-600` rather than double-applying.
    render(<Button className="bg-red-500">Send</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-red-500');
    expect(btn.className).not.toContain('bg-blue-600');
  });

  it('always includes the focus-visible ring affordance (STANDARDS §13)', () => {
    render(<Button>Send</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-blue-500');
    expect(cls).toContain('focus-visible:ring-offset-2');
  });
});

describe('buttonVariants', () => {
  it('returns a base class string for default args', () => {
    const cls = buttonVariants();
    expect(cls).toContain('inline-flex');
    expect(cls).toContain('rounded-md');
  });

  it('composes variant + size deterministically', () => {
    const cls = buttonVariants({ variant: 'ghost', size: 'sm' });
    expect(cls).toContain('hover:bg-zinc-100');
    expect(cls).toContain('h-8');
  });
});
