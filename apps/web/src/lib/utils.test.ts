import { describe, it, expect } from 'vitest';
import { cn, fileNameFromPath } from './utils';

describe('cn', () => {
  describe('Tailwind v4 font-size utility preservation', () => {
    // Regression: tailwind-merge@2 classified `text-caption` (a Tailwind v4
    // @theme font-size utility) in the same "text-color" slot as `text-white`,
    // silently evicting the variant's `text-white`. The result was invisible
    // button labels — dark-on-dark in light mode (sidebar New Chat, modal Done,
    // any `Button` whose `size` slot emits `text-caption`/`text-body`).
    // Fix: extendTailwindMerge registers the four v4 font-size utilities as a
    // distinct `font-size` classGroup.
    it.each([
      ['text-caption', 'md size'],
      ['text-body', 'lg size'],
      ['text-label', 'label size'],
      ['text-heading', 'heading size'],
    ])('preserves `text-white` alongside `%s` (%s)', (fontSize) => {
      const result = cn('text-white', fontSize);
      expect(result).toContain('text-white');
      expect(result).toContain(fontSize);
    });

    it('preserves `text-white` from a variant when the caller adds `text-caption`', () => {
      // Mirrors SidebarHeader: variant="secondary" + className="text-caption ... uppercase"
      const variant =
        'bg-zinc-900 font-semibold text-white shadow-native hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900';
      const caller =
        'text-caption shadow-native h-10 flex-1 gap-2 rounded-lg ps-4 pe-4 font-bold tracking-normal uppercase';
      const result = cn(variant, caller);
      expect(result).toContain('text-white');
      expect(result).toContain('text-caption');
      expect(result).toContain('dark:text-zinc-900');
      expect(result).toContain('bg-zinc-900');
      expect(result).toContain('dark:bg-zinc-100');
    });

    it('preserves `text-white` from a `primary` variant when the caller adds `text-body`', () => {
      // Mirrors ProjectSettings / AddProjectDialog: variant="primary" + className="text-body gap-2"
      const variant =
        'bg-blue-600 font-semibold text-white shadow-native hover:opacity-90 dark:bg-blue-500';
      const caller = 'text-body gap-2';
      const result = cn(variant, caller);
      expect(result).toContain('text-white');
      expect(result).toContain('text-body');
      expect(result).toContain('bg-blue-600');
    });
  });

  describe('real conflicts still resolve (last-wins)', () => {
    // These are the contracts the existing button.test.tsx / input.test.tsx
    // assertions rely on. They must keep passing after the extendTailwindMerge
    // override.
    it('later `bg-*` overrides earlier `bg-*`', () => {
      const result = cn('bg-blue-600', 'bg-red-500');
      expect(result).toContain('bg-red-500');
      expect(result).not.toContain('bg-blue-600');
    });

    it('later `bg-*` overrides `bg-background` semantic token', () => {
      const result = cn('bg-background', 'bg-zinc-100 dark:bg-zinc-800');
      expect(result).toContain('bg-zinc-100');
      expect(result).toContain('dark:bg-zinc-800');
      expect(result).not.toContain('bg-background');
    });

    it('later `text-color` overrides earlier `text-color`', () => {
      const result = cn('text-white', 'text-zinc-900');
      expect(result).toContain('text-zinc-900');
      expect(result).not.toContain('text-white');
    });

    it('deduplicates identical classes', () => {
      const result = cn('px-4', 'px-4');
      // tw-merge collapses duplicates of the same class-group slot
      expect(result.match(/px-4/g)?.length).toBe(1);
    });
  });
});

describe('fileNameFromPath', () => {
  it('extracts the final path segment', () => {
    expect(fileNameFromPath('/home/user/file.txt')).toBe('file.txt');
    expect(fileNameFromPath('C:\\Users\\user\\doc.pdf')).toBe('doc.pdf');
  });

  it('returns the input when no separator is present', () => {
    expect(fileNameFromPath('standalone.txt')).toBe('standalone.txt');
  });
});
