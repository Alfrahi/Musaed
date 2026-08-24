import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkLatexNormalize from './remark-latex-normalize';

const processWithPlugin = (markdown: string): string => {
  const processor = unified().use(remarkParse).use(remarkLatexNormalize).use(remarkStringify);
  return processor.processSync(markdown).toString().trim();
};

describe('remarkLatexNormalize', () => {
  describe('inline delimiters (with preserved backslashes in AST)', () => {
    it('converts \\(...\\) to $...$ when backslashes preserved in source', () => {
      const input = 'Here is some math \\\\(a + b\\\\) inline.';
      const output = processWithPlugin(input);
      expect(output).toContain('$a + b$');
    });

    it('converts \\[...\\] to $$...$$ when backslashes preserved in source', () => {
      const input = 'Block math:\n\\\\[E = mc^2\\\\]';
      const output = processWithPlugin(input);
      // toMarkdown adds newlines around block math
      expect(output).toContain('$$');
      expect(output).toContain('E = mc^2');
    });

    it('handles double backslashes \\(\\) and \\[\\] in source', () => {
      const input = 'Double: \\\\(x\\\\) and \\\\[y\\\\]';
      const output = processWithPlugin(input);
      expect(output).toContain('$x$');
      expect(output).toContain('$$');
      expect(output).toContain('y');
    });

    it('preserves whitespace inside delimiters', () => {
      const input = '\\\\( a + b \\\\)';
      const output = processWithPlugin(input);
      expect(output).toContain('$a + b$');
    });

    it('handles nested content with special characters', () => {
      const input = '\\\\(\\\\frac{1}{2}\\\\)';
      const output = processWithPlugin(input);
      expect(output).toContain('$\\frac{1}{2}$');
    });
  });

  describe('spacing fixes', () => {
    it('fixes \\left[ / \\right] spacing', () => {
      const input = '\\\\(\\\\left[ x \\\\right]\\\\)';
      const output = processWithPlugin(input);
      // toMarkdown escapes [ but not ] in text content
      expect(output).toContain('$\\left\\[');
      expect(output).toContain('\\right]');
    });

    it('fixes \\left{ / \\right} spacing', () => {
      const input = '\\\\(\\\\left\\\\{ x \\\\right\\\\}\\\\)';
      const output = processWithPlugin(input);
      // toMarkdown escapes { and } in text content
      expect(output).toContain('$\\left\\\\{');
      expect(output).toContain('\\right\\\\}');
    });

    it('fixes multiple spacing variations', () => {
      const input = '\\\\(\\\\left  [ a \\\\right  ]\\\\)';
      const output = processWithPlugin(input);
      expect(output).toContain('$\\left\\[');
      expect(output).toContain('\\right]');
    });
  });

  describe('code fence preservation', () => {
    it('does not process content inside code fences', () => {
      const input = '```\n\\\\(not math\\\\)\n```';
      const output = processWithPlugin(input);
      expect(output).toContain('not math');
    });

    it('does not process content inside inline code', () => {
      const input = 'Inline `\\\\(code\\\\)` here';
      const output = processWithPlugin(input);
      expect(output).toContain('code');
    });
  });

  describe('no false positives on prose parentheses', () => {
    it('does not convert (a+b) in prose (no backslashes in AST)', () => {
      const input = 'The value is (a+b) in this equation.';
      const output = processWithPlugin(input);
      expect(output).toContain('(a+b)');
    });

    it('does not convert simple parentheses', () => {
      const input = 'See (Figure 1) for details.';
      const output = processWithPlugin(input);
      expect(output).toContain('(Figure 1)');
    });

    it('does not convert parentheses with text', () => {
      const input = 'This (is a test) of prose.';
      const output = processWithPlugin(input);
      expect(output).toContain('(is a test)');
    });

    it('does not convert parentheses with only numbers', () => {
      const input = 'Value is (42) here.';
      const output = processWithPlugin(input);
      expect(output).toContain('(42)');
    });

    it('does not convert empty parentheses', () => {
      const input = 'Function call () is empty.';
      const output = processWithPlugin(input);
      expect(output).toContain('()');
    });
  });

  describe('mixed content', () => {
    it('converts math but preserves prose', () => {
      const input = 'Text \\\\(math\\\\) more text (not math) end.';
      const output = processWithPlugin(input);
      expect(output).toContain('$math$');
      expect(output).toContain('(not math)');
    });

    it('handles multiple math expressions', () => {
      const input = '\\\\(x\\\\) and \\\\[y\\\\] and \\\\(z\\\\)';
      const output = processWithPlugin(input);
      expect(output).toContain('$x$');
      expect(output).toContain('$$');
      expect(output).toContain('y');
      expect(output).toContain('$z$');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const input = '';
      const output = processWithPlugin(input);
      expect(output).toBe('');
    });

    it('handles input with no math', () => {
      const input = 'Just plain text with no math.';
      const output = processWithPlugin(input);
      expect(output).toContain('Just plain text with no math');
    });

    it('handles already normalized content', () => {
      const input = '$already$ and $$normalized$$';
      const output = processWithPlugin(input);
      expect(output).toContain('$already$');
      expect(output).toContain('$$normalized$$');
    });
  });
});
