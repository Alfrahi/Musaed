/**
 * Utility functions for Mermaid diagram preprocessing and validation.
 */

import DOMPurify from 'dompurify';

/**
 * Detects diagram types that are known to be unsupported or require special handling.
 */
export function detectUnsupportedDiagram(code: string): string | null {
  const trimmed = code.trim();

  if (trimmed.startsWith('xychart-beta')) {
    return 'xychart-beta is not supported in this Mermaid version.';
  }

  return null;
}

/**
 * Sanitizes a rendered Mermaid SVG for dangerouslySetInnerHTML.
 * SVG-mode labels (<text>/<tspan>) survive this profile; HTML-in-SVG labels
 * (<foreignObject>) are hard-disallowed by DOMPurify and must not be re-enabled —
 * mermaid must render with htmlLabels:false (see mermaid-service buildInitConfig).
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: false },
  });
}

/** Fix common syntax issues (comments, pipes, case mismatches). */
const fixCommonSyntax = (processed: string): string => {
  let result = processed;
  result = result.replace(/^\s*\/\/(.*)$/gm, '%% $1');
  result = result.replace(/\|\|--o\s+\{/g, '||--o{');
  return result;
};

/** Convert sankey-beta arrow syntax to comma-separated format. */
const fixSankeyBeta = (processed: string): string => {
  if (!processed.trim().startsWith('sankey-beta') || !processed.includes('-->')) return processed;

  const lines = processed.split('\n');
  const converted: string[] = ['sankey-beta'];

  for (const line of lines) {
    const match = line.match(/(.*?)-->(.*?):\s*(\d+)/);
    if (match) {
      converted.push(`${match[1].trim()},${match[2].trim()},${match[3].trim()}`);
    }
  }

  return converted.length > 1 ? converted.join('\n') : processed;
};

/** Fix pie chart syntax (remove percentages, quote labels). */
const fixPieChart = (processed: string): string => {
  if (!processed.includes('pie')) return processed;

  let result = processed.replace(/\(.*?%\)/g, '');
  if (result.trim().startsWith('pie')) {
    result = result.replace(/^(\s*)([A-Za-z0-9 _-]+)\s*:/gm, '$1"$2":');
  }
  result = result.replace(/(\d+(?:\.\d+)?)%/g, '$1');
  return result;
};

/** Normalize requirementDiagram syntax (case, quotes, descriptions, arrows). */
const fixRequirementDiagram = (processed: string): string => {
  if (!processed.includes('requirementDiagram')) return processed;

  let result = processed
    .replace(/risk:\s*Low/g, 'risk: low')
    .replace(/risk:\s*Medium/g, 'risk: medium')
    .replace(/risk:\s*High/g, 'risk: high')
    .replace(/verifMethod/g, 'verifymethod')
    .replace(/verifymethod:\s*Test/g, 'verifymethod: test')
    .replace(/type:\s*Component/g, 'type: component');

  result = rebuildRequirementLines(result);
  return result;
};

/** Rewrite requirement diagram lines with proper indentation and quoting. */
const rebuildRequirementLines = (processed: string): string => {
  const lines = processed.split('\n');
  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      newLines.push(line);
      continue;
    }
    if (trimmed.startsWith('description:')) {
      newLines.push(`        %% ${trimmed}`);
      continue;
    }
    if (trimmed.match(/\w+\s*-->\s*\w+/)) {
      newLines.push('    ' + trimmed.replace(/(\w+)\s*-->\s*(\w+)/, '$1 - satisfies -> $2'));
      continue;
    }
    if (trimmed.includes(':') && !trimmed.includes('- ')) {
      const [key, ...valueParts] = trimmed.split(':');
      let value = valueParts.join(':').trim();
      if (value && !/^["'].*["']$/.test(value) && (/\s/.test(value) || /["':]/.test(value))) {
        value = `"${value}"`;
      }
      newLines.push(`        ${key.trim()}: ${value}`);
    } else {
      newLines.push(line);
    }
  }
  return newLines.join('\n');
};

/** Rewrite cluster/dependencyGraph as flowchart TD. */
const fixClusterDependencyGraph = (processed: string): string => {
  if (/^(cluster|dependencyGraph)/im.test(processed)) {
    return processed.replace(/^(cluster|dependencyGraph)\b/im, 'flowchart TD');
  }
  return processed;
};

/** Ensure single-quoted strings use double quotes (except in requirementDiagram). */
const fixSingleQuotes = (processed: string): string => {
  if (!processed.includes('requirementDiagram')) {
    return processed.replace(/(\s|^)'([^'\n]+)'(?=\s|$|[;,\]{}])/g, '$1"$2"');
  }
  return processed;
};

/** Format erDiagram entity blocks with proper indentation.
 *  Line-anchored so relationship arrows ending in `{` (e.g. `||--o{`)
 *  are never mistaken for an entity-block opener. */
const fixErDiagram = (processed: string): string => {
  if (!processed.includes('erDiagram')) return processed;
  return processed.replace(
    /^[ \t]*(\w+)[ \t]*\{[ \t]*\n([^}]+)\n[ \t]*\}[ \t]*$/gm,
    (_, entity, attrs) => {
      const formatted = attrs
        .trim()
        .split('\n')
        .map((l: string) => `        ${l.trim()}`)
        .join('\n');
      return `${entity} {\n${formatted}\n    }`;
    }
  );
};

/** Fix quadrantChart value syntax and ensure axis declarations. */
const fixQuadrantChart = (processed: string): string => {
  if (!processed.includes('quadrantChart')) return processed;

  let result = processed.replace(
    /"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/g,
    '"$1": [$2, $3]'
  );
  if (!/x-axis/i.test(result))
    result = result.replace(/^(quadrantChart\s*)/im, '$1\n  x-axis Low --> High\n');
  if (!/y-axis/i.test(result))
    result = result.replace(/^(quadrantChart\s*)/im, '$1\n  y-axis Low --> High\n');
  return result;
};

/** Declare gitGraph branches on first checkout (LLMs often checkout branches they never created). */
const fixGitGraphBranches = (processed: string): string => {
  if (!/^\s*gitGraph\b/im.test(processed)) return processed;

  const known = new Set(['main']);
  const out: string[] = [];
  for (const line of processed.split('\n')) {
    const declared = line.match(/^[ \t]*branch[ \t]+("[^"]+"|[\w./-]+)/);
    if (declared) {
      known.add(declared[1]);
    } else {
      const checkedOut = line.match(/^[ \t]*checkout[ \t]+("[^"]+"|[\w./-]+)/);
      if (checkedOut && !known.has(checkedOut[1])) {
        out.push(`${line.match(/^[ \t]*/)?.[0]}branch ${checkedOut[1]}`);
        known.add(checkedOut[1]);
      }
    }
    out.push(line);
  }
  return out.join('\n');
};

/** Convert hallucinated gantt rows (`project|task Name,start..end`) to canonical `Name :start,end`. */
const fixGanttPseudoSyntax = (processed: string): string => {
  if (!processed.includes('gantt')) return processed;

  return processed.replace(
    /^([ \t]*)(?:project|task)\b[ \t]+([^,\n]+?),[ \t]*(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})[ \t]*$/gim,
    (_m, indent: string, name: string, start: string, end: string) =>
      `${indent}${name.trim()} :${start}, ${end}`
  );
};

/**
 * Fix gantt chart: add dateFormat/axisFormat if missing, repair bare text-duration
 * task lines. Lines whose data section already contains a date (canonical
 * `Name :tags, id, start, end` forms) are left untouched.
 */
const fixGantt = (processed: string): string => {
  if (!processed.includes('gantt')) return processed;

  let result = processed;
  if (!/dateFormat/i.test(result))
    result = result.replace(/^(gantt\b)/im, '$1\n  dateFormat YYYY-MM-DD');
  if (!/axisFormat/i.test(result))
    result = result.replace(/^(gantt\b)/im, '$1\n  axisFormat %Y-%m-%d');

  result = result.replace(
    /^(\s*)([^:\n]+?)\s*:\s*(?![^:\n]*\d{4}-\d{2}-\d{2})(?![\d-]|after|crit|done|milestone|active)([^,\n]+?)(?:,\s*([^\n]+))?$/gm,
    (_, indent, taskName, __, durationPart) => {
      const cleanTask = taskName.trim();
      const duration = (durationPart?.trim() || '7d').replace(/^\s*,\s*/, '');
      return `${indent}${cleanTask} : 2026-01-01, ${duration}`;
    }
  );
  return result;
};

/**
 * Repair LLM flowcharts that use display names as node ids: bare ids cannot
 * contain spaces, so `User writes message[label]`, multi-word edge endpoints and
 * `style Name With Spaces ...` all break the parser. Rewrites them to slugged
 * ids with quoted labels. Also strips stray `|label|>` closers. Open-link
 * arrows without `>` (`A --- B`) are not endpoint-rewritten.
 */
const fixMultiWordNodes = (processed: string): string => {
  if (!/^(flowchart|graph)\b/im.test(processed)) return processed;

  const slugId = (name: string): string =>
    name
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\p{L}\p{N}_-]/gu, '') || 'node';

  const result = processed.replace(/\|([^|\n]*)\|>/g, '|$1|');

  const lines = result.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /^[ \t]*(?:flowchart|graph|subgraph|end|direction|classDef|class|click|linkStyle|%%)\b/i.test(
        line
      )
    ) {
      continue;
    }
    if (/^[ \t]*style\b/i.test(line)) {
      lines[i] = line.replace(
        /^([ \t]*style[ \t]+)(.+?)(?=[ \t]+[a-z-]+[ \t]*:)/i,
        (_m, prefix: string, name: string) => prefix + (name.includes(' ') ? slugId(name) : name)
      );
      continue;
    }
    lines[i] = line.replace(
      /\b([A-Za-z]\w*(?:[ \t]+[A-Za-z0-9]\w*)+)[ \t]*\[([^[\]]*)\]/g,
      (_m, name: string, label: string) => `${slugId(name)}["${label.trim()}"]`
    );

    if (lines[i].includes('>')) {
      const spans: string[] = [];
      let work = lines[i].replace(/("[^"]*"|\|[^|\n]*\|)/g, (m) => {
        spans.push(m);
        return `\u0000${spans.length - 1}\u0000`;
      });
      work = work.replace(
        /(^|[>\s])([A-Za-z]\w*(?:[ \t]+[A-Za-z0-9]\w*)+)(?=[ \t]*(?:-{2,3}>|={2,3}>|-\.{1,3}>|\||;|$))/g,
        (_m, pre: string, name: string) => `${pre}${slugId(name)}["${name.trim()}"]`
      );
      work = work.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => spans[Number(idx)]);
      lines[i] = work;
    }
  }
  return lines.join('\n');
};

/** Lowercase capitalized `Subgraph` headers (the keyword is case-sensitive). */
const fixSubgraphCase = (processed: string): string => {
  if (!/^(flowchart|graph)\b/im.test(processed)) return processed;
  return processed.replace(/^[ \t]*Subgraph(?=[ \t]+\S)/gm, 'subgraph');
};

/** Quote flowchart node labels containing parentheses (bare parens break the parser). */
const quoteParenLabels = (processed: string): string => {
  if (!/^(flowchart|graph)\b/im.test(processed)) return processed;
  return processed.replace(/\[([^\]"[\n]*\([^)\]]*\)[^"\][\n]*)\]/g, '["$1"]');
};

/** Normalize flowchart/graph keyword, preserving the declared direction. */
const fixFlowchart = (processed: string): string => {
  if (!/^(flowchart|graph)/im.test(processed)) return processed;

  let result = processed.replace(
    /^(flowchart|graph)(?:[ \t]+(\w+))?/im,
    (_match, _keyword: string, direction?: string) =>
      direction ? `flowchart ${direction.toUpperCase()}` : 'flowchart TD'
  );
  result = result.replace(/->>/g, '-->');
  result = result.replace(/([^\n;}])\s*$/gm, '$1;');
  return result;
};

/** Detect if a flowchart/graph line mentions 'requirement' (needs diagram-type swap). */
const shouldSwapToRequirement = (processed: string): boolean =>
  /^(graph|flowchart)/im.test(processed) && processed.includes('requirement ');

/**
 * Repair stateDiagram-v2 polluted with sequenceDiagram syntax (`participant`,
 * `note over`, `order X ->> Y`, `end X`). Extracts the `state "X"` declarations
 * and reconstructs a valid linear state machine: `[*] --> A --> B --> ...`.
 */
const fixStateDiagram = (processed: string): string => {
  if (!/^stateDiagram(-v2)?\b/im.test(processed)) return processed;

  const header = processed.match(/^stateDiagram(-v2)?/im)?.[0] ?? 'stateDiagram-v2';

  // Collect unique state names in order of first appearance.
  const states: string[] = [];
  const seen = new Set<string>();
  for (const line of processed.split('\n')) {
    const m = line.trim().match(/^state\s+["']?([^"']+?)["']?\s*$/i);
    if (m) {
      const name = m[1].trim();
      if (!seen.has(name)) {
        seen.add(name);
        states.push(name);
      }
    }
  }

  if (states.length === 0) return processed;

  // State ids must be bare identifiers (no spaces, no quotes). Slug them.
  const slug = (s: string): string =>
    s.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '') || 'state';

  const ids = states.map(slug);
  const transitions = [`[*] --> ${ids[0]}`];
  for (let i = 1; i < ids.length; i++) {
    transitions.push(`${ids[i - 1]} --> ${ids[i]}`);
  }

  return [header, ...transitions].join('\n');
};

/**
 * Repair gantt charts polluted with hallucinated attributes (`duration="…"`,
 * `after "…"`, `gantt-title`). Converts `task "Name" duration="1d"` rows into
 * canonical `Name :start, duration` task lines with sequential start dates, and
 * drops `after`/`gantt-title` noise. Sequential dates avoid Mermaid's
 * `prevTask.endTime` crash when tasks carry only a duration.
 */
const fixGanttAttributes = (processed: string): string => {
  if (!processed.includes('gantt')) return processed;

  const lines = processed.split('\n');
  const out: string[] = [];
  let day = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (/^gantt-title\b/i.test(trimmed)) continue;

    const taskMatch = trimmed.match(
      /^(?:task|Task)\s+["']?([^"']+?)["']?\s+(?:after\s+["'][^"']+["']\s*,\s*)?duration\s*=\s*["']([^"']+)["']/i
    );
    if (taskMatch) {
      const name = taskMatch[1].trim();
      const duration = taskMatch[2].trim();
      const start = `2026-01-${String(day).padStart(2, '0')}`;
      out.push(`${line.match(/^[ \t]*/)?.[0]}${name} :${start}, ${duration}`);
      day += 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Repair pie charts polluted with `label X (N)`, `size: N`, `style: …` lines.
 * Converts `label Apple (40)` into `"Apple" : 40` and drops `size`/`style`.
 */
const fixPieLabels = (processed: string): string => {
  if (!processed.includes('pie')) return processed;

  const lines = processed.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (/^(size|style)\s*:/i.test(trimmed) || /^["'](size|style)["']\s*:/i.test(trimmed)) continue;

    const labelMatch = trimmed.match(/^label\s+(.+?)\s*\((\d+(?:\.\d+)?)\)\s*$/i);
    if (labelMatch) {
      out.push(`${line.match(/^[ \t]*/)?.[0]}"${labelMatch[1].trim()}" : ${labelMatch[2]}`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Repair erDiagram polluted with `--|*` crow's foot, `Note over …` lines, and
 * `Entity(attr: type, …)` inline attribute syntax. Rewrites the relationship
 * to a valid `||--o{` form, drops notes, and converts inline attrs to blocks.
 */
const fixErDiagramSyntax = (processed: string): string => {
  if (!processed.includes('erDiagram')) return processed;

  const result = processed.replace(/--\|(\*|o)/g, '||--o{');

  const lines = result.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (/^Note\s+over\b/i.test(trimmed)) continue;

    // Quote unquoted relationship labels containing spaces.
    if (/^[A-Za-z_]\w*\s+[|o}{]/.test(trimmed) && trimmed.includes(':')) {
      const rel = trimmed.replace(/:\s*([^"'][^\n]*)$/, (_m, label: string) => {
        const clean = label.trim();
        return /^["']/.test(clean) ? `: ${clean}` : `: "${clean}"`;
      });
      out.push(line.replace(trimmed, rel));
      continue;
    }

    const inline = trimmed.match(/^(\w+)\(([^)]+)\)\s*$/);
    if (inline) {
      const entity = inline[1];
      const attrs = inline[2]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => `        ${a.replace(/:\s*/g, ' ')}`)
        .join('\n');
      out.push(`    ${entity} {\n${attrs}\n    }`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Repair gitGraph polluted with flowchart/sequence syntax (`style`, `note`,
 * `fill`, `stroke`, `-->|commit|>`). Strips those lines, keeping only valid
 * gitGraph directives (`commit`, `branch`, `checkout`, `merge`).
 */
const fixGitGraphSyntax = (processed: string): string => {
  if (!/^\s*gitGraph\b/im.test(processed)) return processed;

  const lines = processed.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (
      /^(style|note|fill|stroke)\b/i.test(trimmed) ||
      /-->/.test(trimmed) ||
      /^branch-name\b/i.test(trimmed)
    ) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Repair mindmap polluted with `+--` prefixes and multiple root nodes. Strips
 * the `+--` marker and, when more than one top-level node exists, keeps only
 * the first as root (indenting the rest under it).
 */
const fixMindmap = (processed: string): string => {
  if (!/^mindmap\b/im.test(processed)) return processed;

  const result = processed.replace(/^([ \t]*)\+--\s*/gm, '$1');

  const lines = result.split('\n');
  // Determine the minimum indentation among non-empty, non-header lines; that
  // level is the root level (LLMs often indent roots uniformly).
  let minIndent = Infinity;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^mindmap\b/i.test(trimmed)) continue;
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) return result;

  const roots: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /^mindmap\b/i.test(trimmed)) continue;
    const indent = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent === minIndent) roots.push(i);
  }

  if (roots.length > 1) {
    for (let i = 1; i < roots.length; i++) {
      lines[roots[i]] = `  ${lines[roots[i]]}`;
    }
  }
  return lines.join('\n');
};

/**
 * Repair timeline/gantt polluted with `note over …` lines. Drops notes; the
 * `duration=`/`after` attribute repair is handled by fixGanttAttributes.
 */
const fixTimeline = (processed: string): string => {
  if (!processed.includes('gantt') && !/^timeline\b/im.test(processed)) return processed;

  const lines = processed.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (/^note\s+over\b/i.test(trimmed)) continue;
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Preprocesses mermaid content to fix common LLM mistakes and compatibility issues.
 */
export function preprocessMermaidContent(raw: string): string {
  let processed = raw.trim();

  if (shouldSwapToRequirement(processed)) {
    processed = processed.replace(/^(graph|flowchart)[^\n]*/im, 'requirementDiagram');
  }

  if (processed.startsWith('requirementDiagram')) {
    processed = processed.replace(/^\s*\w+\[[^\]]+\]\s*$/gm, '');
  }

  processed = fixCommonSyntax(processed);
  processed = fixRequirementDiagram(processed);
  processed = fixSankeyBeta(processed);
  processed = fixPieChart(processed);
  processed = fixPieLabels(processed);
  processed = fixClusterDependencyGraph(processed);
  processed = fixRequirementDiagram(processed);
  processed = fixSingleQuotes(processed);
  processed = fixErDiagram(processed);
  processed = fixErDiagramSyntax(processed);
  processed = fixQuadrantChart(processed);
  processed = fixGitGraphBranches(processed);
  processed = fixGitGraphSyntax(processed);
  processed = fixGanttPseudoSyntax(processed);
  processed = fixGantt(processed);
  processed = fixGanttAttributes(processed);
  processed = fixStateDiagram(processed);
  processed = fixMindmap(processed);
  processed = fixTimeline(processed);
  processed = fixMultiWordNodes(processed);
  processed = fixSubgraphCase(processed);
  processed = quoteParenLabels(processed);
  processed = fixFlowchart(processed);

  return processed;
}
