import type { Plugin } from 'unified';
import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin to normalize LaTeX delimiters at the AST level.
 *
 * Converts various LaTeX delimiter formats to standard $...$ and $$...$$ format
 * that remark-math can parse. Operates on text nodes only, preserving code fences
 * and other markdown structures.
 *
 * Supported conversions (on text node values):
 * - \(...\) → $...$ (when backslashes are preserved in AST, e.g. from double-escaped source)
 * - \[...\] → $$...$$ (when backslashes are preserved in AST)
 * - Fixes \left[/\right] and \left{/\right} spacing
 *
 * Note: Standard markdown parsing unescapes \(...\) to (...). For the plugin to
 * detect explicit LaTeX delimiters, the source should use double backslashes
 * (\\(...\\) and \\[...\\]) which survive parsing as single backslashes.
 * The heuristic parentheses conversion ((a+b) → $a+b$) is intentionally omitted.
 */
export const remarkLatexNormalize: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text) => {
      let value = node.value;

      // Convert \(...\) to $...$ (for preserved backslashes in AST)
      value = value.replace(
        /\\{1,2}\(\s*([\s\S]*?)\s*\\{1,2}\)/g,
        (_match: string, inner: string) => `$${inner.trim()}$`
      );

      // Convert \[...\] to $$...$$ (for preserved backslashes in AST)
      value = value.replace(
        /\\{1,2}\[\s*([\s\S]*?)\s*\\{1,2}\]/g,
        (_match: string, inner: string) => `\n$$\n${inner.trim()}\n$$\n`
      );

      // Fix \left[ / \right] spacing
      value = value.replace(/\\left\s*\[/g, '\\left[');
      value = value.replace(/\\right\s*\]/g, '\\right]');

      // Fix \left{ / \right} spacing
      value = value.replace(/\\left\s*\{/g, '\\left\\{');
      value = value.replace(/\\right\s*\}/g, '\\right\\}');

      if (value !== node.value) {
        node.value = value;
      }
    });
  };
};

export default remarkLatexNormalize;
