import { describe, it, expect } from 'vitest';
import {
  detectUnsupportedDiagram,
  preprocessMermaidContent,
  sanitizeMermaidSvg,
} from './mermaid-utils';

describe('mermaid-utils', () => {
  describe('sanitizeMermaidSvg', () => {
    it('keeps SVG-mode label text (<text>/<tspan>)', () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10"><tspan>User writes</tspan></text></svg>';
      const clean = sanitizeMermaidSvg(svg);
      expect(clean).toContain('<text');
      expect(clean).toContain('User writes');
    });

    it('strips scripts and event handlers from hostile payloads', () => {
      const hostile =
        '<svg><foreignObject><div onclick="pwn()"><script>alert(1)</script>TEXT</div></foreignObject></svg>';
      const clean = sanitizeMermaidSvg(hostile);
      expect(clean).not.toContain('onclick');
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('alert');
    });

    it('removes foreignObject label content entirely (DOMPurify hard-disallows it)', () => {
      const svg =
        '<svg><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><span>label</span></div></foreignObject></svg>';
      expect(sanitizeMermaidSvg(svg)).not.toContain('label');
    });
  });

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

    it('preserves crow-foot relationship lines ending in o{', () => {
      const input =
        'erDiagram\n    User ||--o{ Conversation : "has many"\n\n    User {\n        string id\n    }';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('User ||--o{ Conversation : "has many"');
      expect(result).not.toContain('||--o {');
      expect(result).toContain('string id');
    });

    it('keeps the full user-reported diagram parseable shape', () => {
      const input =
        'erDiagram\n    User ||--o{ Conversation : "has many"\n    Conversation }o--|| Message : "has many"\n\n    User {\n        string id\n    }\n    Message {\n        string id\n    }';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('User ||--o{ Conversation : "has many"');
      expect(result).toContain('Conversation }o--|| Message : "has many"');
      expect(result).toContain('User {');
      expect(result).toContain('Message {');
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

  describe('preprocessMermaidContent - gitGraph', () => {
    it('declares a branch on first checkout of an unknown branch', () => {
      const input = `gitGraph
    commit
    checkout main
    commit
    checkout feature/auth
    commit`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('branch feature/auth');
      expect(result.indexOf('branch feature/auth')).toBeLessThan(
        result.indexOf('checkout feature/auth')
      );
    });

    it('leaves fully valid gitGraph sources unchanged', () => {
      const input = `gitGraph
    branch dev
    checkout dev
    commit
    checkout main
    merge dev`;
      const result = preprocessMermaidContent(input);
      expect(result).toBe(input);
    });

    it('injects each missing branch only once', () => {
      const input = `gitGraph
    checkout dev
    commit
    checkout main
    commit
    checkout dev`;
      const result = preprocessMermaidContent(input);
      expect(result.match(/branch dev/g)).toHaveLength(1);
    });
  });

  describe('preprocessMermaidContent - multi-word node ids', () => {
    it('slugs multi-word declarations, endpoints, and style targets', () => {
      const input = `graph LR
    User writes message[User Writes Message]
    Validate input[Validate Input]
    Validate input -->|VALID|> Add message to UI[Add Message to UI]
    Validate input -->|INVALID|> Validation Error
    style Validation Error fill:#f9e0b3,stroke:#999`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('User_writes_message["User Writes Message"]');
      expect(result).toMatch(/Validate_input\[.*\] -->\|VALID\| Add_message_to_UI\[/);
      expect(result).toContain('-->|INVALID| Validation_Error["Validation Error"]');
      expect(result).toContain('style Validation_Error fill:#f9e0b3,stroke:#999');
      expect(result).not.toContain('|>');
    });

    it('leaves single-token nodes and valid flowcharts unchanged', () => {
      const input = 'flowchart TD\n  A[Label] --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('flowchart TD;\n  A[Label] --> B;');
    });

    it('does not touch subgraph titles or edge labels', () => {
      const input = 'graph LR\n  A -->|edge label| B\n  subgraph My Group\n  X --> Y\n  end';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('|edge label|');
      expect(result).toContain('subgraph My Group');
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

    it('preserves canonical task lines with ids and dates', () => {
      const input =
        'gantt\n  dateFormat YYYY-MM-DD\n  axisFormat %Y-%m-%d\n  Task 1 :t1, 2022-01-01, 2022-01-31';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('Task 1 :t1, 2022-01-01, 2022-01-31');
    });

    it('converts pseudo-syntax project/task rows to canonical tasks', () => {
      const input = `gantt
    title Project Schedule
    project Task 1,2022-01-01..2022-01-31
    task Task 2,2022-02-01..2022-02-28
    task Task 3,2022-03-01..2022-03-31`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('Task 1 :2022-01-01, 2022-01-31');
      expect(result).toContain('Task 2 :2022-02-01, 2022-02-28');
      expect(result).toContain('Task 3 :2022-03-01, 2022-03-31');
      expect(result).not.toMatch(
        /^[ \t]*(?:project|task)\b[ \t]+[^,\n]+,[ \t]*\d{4}-\d{2}-\d{2}\.\./im
      );
      expect(result).not.toContain('..');
    });
  });

  describe('preprocessMermaidContent - subgraph casing', () => {
    it('lowercases capitalized Subgraph headers', () => {
      const input = 'graph LR\nA --> B\n\nSubgraph Persist\nB\nend';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('\nsubgraph Persist');
      expect(result).not.toContain('Subgraph');
    });
  });

  describe('preprocessMermaidContent - paren label quoting', () => {
    it('quotes node labels containing parentheses', () => {
      const input = 'graph TD\n    A[State Mgmt (e.g., Redux)] --> B[Tauri IPC (IPC)]';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('A["State Mgmt (e.g., Redux)"]');
      expect(result).toContain('B["Tauri IPC (IPC)"]');
    });

    it('leaves already-quoted labels and edge labels untouched', () => {
      const input = 'flowchart TD\n    A["kept (as-is)"] -->|edge (label)| B';
      const result = preprocessMermaidContent(input);
      expect(result).toContain('A["kept (as-is)"]');
      expect(result).toContain('|edge (label)|');
    });
  });

  describe('preprocessMermaidContent - flowchart', () => {
    it('normalizes graph keyword while preserving declared direction', () => {
      const input = 'graph LR\n  A --> B';
      const result = preprocessMermaidContent(input);
      expect(result).toBe('flowchart LR;\n  A --> B;');
    });

    it('defaults to TD when no direction is given', () => {
      const input = 'graph\n  A --> B';
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

  describe('preprocessMermaidContent - stateDiagram', () => {
    it('strips sequence syntax (participant/note over/order ->>/end)', () => {
      const input = `stateDiagram-v2
    participant Order
    note over Order: An order is created.
    state "Pending"
    order Order ->> Order: Process Payment
    note over Order: Payment processed.
    state "Paid"
    end Order: done`;
      const result = preprocessMermaidContent(input);
      expect(result).not.toContain('participant');
      expect(result).not.toContain('note over');
      expect(result).not.toContain('->>');
      expect(result).not.toContain('end Order');
      // Reconstructed as a linear state machine with slugged ids.
      expect(result).toContain('[*] --> Pending');
      expect(result).toContain('Pending --> Paid');
    });
  });

  describe('preprocessMermaidContent - gantt attributes', () => {
    it('converts task "Name" duration="1d" to canonical task line with dates', () => {
      const input = `gantt
    title Project Schedule
    task "Design" duration="1d"
    task "Build" after "Design", duration="1d"
    gantt-title Project Timeline`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('Design :2026-01-01, 1d');
      expect(result).toContain('Build :2026-01-02, 1d');
      expect(result).not.toContain('duration=');
      expect(result).not.toContain('after "Design"');
      expect(result).not.toContain('gantt-title');
    });
  });

  describe('preprocessMermaidContent - pie labels', () => {
    it('converts label X (N) to "X" : N and drops size/style', () => {
      const input = `pie
    title Market Share
    label Apple (40)
    label Samsung (30)
    size: 300
    style: solid`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('"Apple" : 40');
      expect(result).toContain('"Samsung" : 30');
      expect(result).not.toContain('label ');
      expect(result).not.toContain('size:');
      expect(result).not.toContain('style:');
    });
  });

  describe('preprocessMermaidContent - erDiagram syntax', () => {
    it('fixes --|* crow foot and strips Note over', () => {
      const input = `erDiagram
    Customer --|* Order : Places Many Orders
    Note over Customer,Order: Customer Information`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('||--o{');
      expect(result).not.toContain('--|*');
      expect(result).not.toContain('Note over');
    });

    it('converts inline Entity(attr: type) to entity block', () => {
      const input = `erDiagram
    Customer(id: int, name: string)
    Order(id: int, amount: float)`;
      const result = preprocessMermaidContent(input);
      expect(result).toContain('Customer {');
      expect(result).toContain('id int');
      expect(result).toContain('name string');
      expect(result).toContain('Order {');
      expect(result).toContain('amount float');
    });
  });

  describe('preprocessMermaidContent - gitGraph syntax', () => {
    it('strips style/note/fill/stroke and --> arrows', () => {
      const input = `gitGraph
    style main fill:#f9f,stroke:#333
    note right of main: Initial commit
    A -->|commit|> B
    commit
    branch feature
    checkout feature
    commit
    merge main`;
      const result = preprocessMermaidContent(input);
      expect(result).not.toContain('style');
      expect(result).not.toContain('note');
      expect(result).not.toContain('-->');
      expect(result).toContain('commit');
      expect(result).toContain('branch feature');
      expect(result).toContain('merge main');
    });
  });

  describe('preprocessMermaidContent - mindmap', () => {
    it('strips +-- prefix and collapses multiple roots', () => {
      const input = `mindmap
    Design
        +-- Wireframing
        +-- Prototyping
    Development
        +-- Frontend
    Testing
        +-- Unit`;
      const result = preprocessMermaidContent(input);
      expect(result).not.toContain('+--');
      // Only the first root (Design) stays at the minimum indent level
      expect(result).toContain('\n    Design\n');
      expect(result).toContain('\n      Development\n');
      expect(result).toContain('\n      Testing\n');
    });
  });

  describe('preprocessMermaidContent - timeline', () => {
    it('strips note over and normalizes Task "X" duration="1w" with dates', () => {
      const input = `gantt
    title Project Timeline
    note over Kickoff: Project begins
    Task "Kickoff" duration="1w"
    Task "Design" after "Kickoff", duration="2w"`;
      const result = preprocessMermaidContent(input);
      expect(result).not.toContain('note over');
      expect(result).toContain('Kickoff :2026-01-01, 1w');
      expect(result).toContain('Design :2026-01-02, 2w');
      expect(result).not.toContain('duration=');
    });
  });
});
