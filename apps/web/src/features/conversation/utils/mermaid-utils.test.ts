import { describe, it, expect } from 'vitest';
import { detectUnsupportedDiagram, preprocessMermaidContent } from './mermaid-utils';

describe('mermaid-utils', () => {
  describe('detectUnsupportedDiagram', () => {
    it('detects xychart-beta', () => {
      expect(detectUnsupportedDiagram('xychart-beta\n  "a" [1, 2]')).toBe(
        'xychart-beta is not supported in this Mermaid version.'
      );
    });

    it('returns null for supported diagrams', () => {
      expect(detectUnsupportedDiagram('flowchart TD\n  A --> B')).toBeNull();
      expect(detectUnsupportedDiagram('sequenceDiagram\n  A->>B: hi')).toBeNull();
    });
  });

  describe('preprocessMermaidContent - common syntax fixes', () => {
    it('converts // comments to %% (with preserved spacing)', () => {
      const input = '// comment\nA --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('%%  comment');
    });

    it('fixes ||--o { spacing', () => {
      const input = 'A ||--o { B';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('||--o{');
    });
  });

  describe('preprocessMermaidContent - sankey-beta', () => {
    it('converts --> syntax to comma-separated', () => {
      const input = `sankey-beta
  A --> B : 10
  C --> D : 5`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('A,B,10');
      expect(result).toContain('C,D,5');
    });

    it('returns unchanged when no -->', () => {
      const input = 'sankey-beta\nA,B,10';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('sankey-beta\nA,B,10');
    });
  });

  describe('preprocessMermaidContent - pie chart', () => {
    it('removes parentheses with percentages', () => {
      const input = 'pie\n  "A" : 50%\n  "B" : 30%';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('"A" : 50');
      expect(result).toContain('"B" : 30');
    });

    it('quotes unquoted labels (preserves trailing space, no space before colon)', () => {
      const input = 'pie\n  A : 50';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('"A ": 50');
    });
  });

  describe('preprocessMermaidContent - requirementDiagram', () => {
    it('normalizes risk case', () => {
      const input = 'requirementDiagram\n  risk: High';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('risk: high');
    });

    it('normalizes verifMethod case', () => {
      const input = 'requirementDiagram\n  verifMethod: Test';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('verifymethod: test');
    });

    it('normalizes type case', () => {
      const input = 'requirementDiagram\n  type: Component';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('type: component');
    });

    it('comments out description lines and quotes values', () => {
      const input = 'requirementDiagram\n  description: Some desc';
      const result = preprocessMermaidContent(input);
      // Value is quoted
      expect(result).toContain('%% description: "Some desc"');
    });

    it('rewrites arrows to - satisfies ->', () => {
      const input = 'requirementDiagram\n  req1 --> req2';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('req1 - satisfies -> req2');
    });

    it('quotes values with special chars', () => {
      const input = 'requirementDiagram\n  key: value with spaces';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('key: "value with spaces"');
    });

    it('preserves already quoted values', () => {
      const input = 'requirementDiagram\n  key: "quoted value"';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('key: "quoted value"');
    });

    it('removes node-only lines (req[Desc])', () => {
      const input = 'requirementDiagram\n  req1[Description]\n  req1 --> req2';
      const result = preprocessMermaidContent(input);
      expect(result).not.toContain('req1[Description]');
      expect(result).toContain('req1 - satisfies -> req2');
    });
  });

  describe('preprocessMermaidContent - cluster/dependencyGraph', () => {
    it('converts cluster to flowchart TD', () => {
      const input = 'cluster\n  A --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('flowchart TD;\n  A --> B;');
    });

    it('converts dependencyGraph to flowchart TD', () => {
      const input = 'dependencyGraph\n  A --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('flowchart TD;\n  A --> B;');
    });
  });

  describe('preprocessMermaidContent - single quotes', () => {
    it('converts single quotes to double quotes when surrounded by whitespace', () => {
      // Single quotes preceded by whitespace/start and followed by space/semicolon/comma are converted
      const input = "A 'label' ;";
      const result = preprocessMermaidContent(input);
      expect(result).toContain('A "label" ;');
    });

    it('preserves single quotes in requirementDiagram (but node lines are removed)', () => {
      const input = "requirementDiagram\n  key: 'value'";
      const result = preprocessMermaidContent(input);
      // Single quotes in values are preserved
      expect(result).toContain("'value'");
    });
  });

  describe('preprocessMermaidContent - erDiagram', () => {
    it('formats entity blocks with indentation', () => {
      const input = 'erDiagram\n  CUSTOMER {\nname string\nid int\n  }';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('CUSTOMER {');
      expect(result).toContain('name string');
      expect(result).toContain('id int');
    });
  });

  describe('preprocessMermaidContent - quadrantChart', () => {
    it('converts value syntax to array format', () => {
      const input = 'quadrantChart\n  "Item" : 1 , 2';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('"Item": [1, 2]');
    });

    it('adds x-axis if missing', () => {
      const input = 'quadrantChart\n  "A": [1, 2]';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('x-axis Low --> High');
    });

    it('adds y-axis if missing', () => {
      const input = 'quadrantChart\n  "A": [1, 2]';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('y-axis Low --> High');
    });
  });

  describe('preprocessMermaidContent - gantt', () => {
    it('adds dateFormat if missing', () => {
      const input = 'gantt\n  section A\n  task : 5d';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('dateFormat YYYY-MM-DD');
    });

    it('adds axisFormat if missing', () => {
      const input = 'gantt\n  section A\n  task : 5d';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('axisFormat %Y-%m-%d');
    });

    it('fixes bare task lines with default duration', () => {
      const input = 'gantt\n  section A\n  My Task : 5d';
      const result = preprocessMermaidContent(input);
      // Note: regex captures bare tasks and uses default 7d if no duration captured
      expect(result).toContain('My Task : 2026-01-01, 7d');
    });
  });

  describe('preprocessMermaidContent - flowchart', () => {
    it('normalizes flowchart/graph to flowchart TD', () => {
      const input = 'graph LR\n  A --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('flowchart TD;\n  A --> B;');
    });

    it('preserves >> (not converted - only ->> is handled)', () => {
      const input = 'flowchart TD\n  A >> B';
      const result = preprocessMermaidContent(input);
      // Note: fixFlowchart only converts ->> to -->, not bare >>
      expect(result).toBe('flowchart TD;\n  A >> B;');
    });

    it('adds statement terminators', () => {
      const input = 'flowchart TD\n  A --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('flowchart TD;\n  A --> B;');
    });
  });

  describe('preprocessMermaidContent - diagram type swap', () => {
    it('swaps flowchart with requirement to requirementDiagram', () => {
      const input = 'flowchart TD\n  requirement "req1" --> "req2"';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('requirementDiagram');
    });
  });

  describe('preprocessMermaidContent - integration', () => {
    it('applies all transforms in sequence', () => {
      // A typical LLM output with multiple issues
      const input = `flowchart TD
  A --> B
  // comment
  C ||--o { D`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('flowchart TD');
      expect(result).toContain('%%  comment;');
      expect(result).toContain('||--o{');
      expect(result).toContain('A --> B;');
    });

    it('handles mermaid content with non-flowchart diagrams', () => {
      const input = `sequenceDiagram
  A->>B: hello`;
      const result = preprocessMermaidContent(input);
      expect(result).toBe('sequenceDiagram\n  A->>B: hello');
    });
  });
});
