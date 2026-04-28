/**
 * Utility functions for Mermaid diagram preprocessing and validation.
 */

const SUPPORTED_DIAGRAM_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline', 'gitGraph', 'requirementDiagram',
  'architecture', 'block', 'c4Diagram', 'xyChart', 'sankey-beta', 'quadrantChart', 'radarChart',
  'barChart', 'packetDiagram', 'blockDiagram', 'dependencyGraph'
] as const;

/**
 * Extracts mermaid content from a string and determines if it's a valid diagram.
 */
export function extractMermaidContent(content: string): string {
  if (!content?.trim()) return '';

  let match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  if (!match) {
    match = content.match(/```\s*([\s\S]*?)```/);
  }

  if (match?.[1]) return match[1].trim();

  const looksLikeMermaid = SUPPORTED_DIAGRAM_TYPES.some((type) =>
    content.trim().startsWith(type) || content.includes(type)
  );

  return looksLikeMermaid ? content.trim() : '';
}

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
 * Preprocesses mermaid content to fix common LLM mistakes and compatibility issues.
 */
export function preprocessMermaidContent(raw: string): string {
  let processed = raw.trim();

  if (
    /^(graph|flowchart)/im.test(processed) &&
    processed.includes('requirement ')
  ) {
    processed = processed.replace(/^(graph|flowchart)[^\n]*/im, 'requirementDiagram');
  }

  if (processed.startsWith('requirementDiagram')) {
    processed = processed.replace(/^\s*\w+\[[^\]]+\]\s*$/gm, '');
  }

  processed = processed.replace(/^\s*\/\/(.*)$/gm, '%% $1');
  processed = processed.replace(/\|\|--o\s+\{/g, '||--o{');

  if (processed.includes('requirementDiagram')) {
    processed = processed
      .replace(/risk:\s*Low/g, 'risk: low')
      .replace(/risk:\s*Medium/g, 'risk: medium')
      .replace(/risk:\s*High/g, 'risk: high')
      .replace(/verifMethod/g, 'verifymethod')
      .replace(/verifymethod:\s*Test/g, 'verifymethod: test')
      .replace(/type:\s*Component/g, 'type: component');
  }

  if (processed.trim().startsWith('sankey-beta') && processed.includes('-->')) {
    const lines = processed.split('\n');
    const converted: string[] = ['sankey-beta'];

    for (const line of lines) {
      const match = line.match(/(.*?)-->(.*?):\s*(\d+)/);
      if (match) {
        const source = match[1].trim();
        const target = match[2].trim();
        const value = match[3].trim();
        converted.push(`${source},${target},${value}`);
      }
    }

    if (converted.length > 1) {
      processed = converted.join('\n');
    }
  }

  if (processed.includes('pie')) {
    processed = processed.replace(/\(.*?%\)/g, '');
    if (processed.trim().startsWith('pie')) {
      processed = processed.replace(
        /^(\s*)([A-Za-z0-9 _-]+)\s*:/gm,
        '$1"$2":'
      );
    }
    processed = processed.replace(/(\d+(?:\.\d+)?)%/g, '$1');
  }

  if (/^(cluster|dependencyGraph)/im.test(processed)) {
    processed = processed.replace(/^(cluster|dependencyGraph)\b/im, 'flowchart TD');
  }

  if (processed.includes('requirementDiagram')) {
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
        const fixed = trimmed.replace(/(\w+)\s*-->\s*(\w+)/, '$1 - satisfies -> $2');
        newLines.push('    ' + fixed);
        continue;
      }
      if (trimmed.includes(':') && !trimmed.includes('- ')) {
        const [key, ...valueParts] = trimmed.split(':');
        let value = valueParts.join(':').trim();
        if (value && !/^["'].*["']$/.test(value)) {
          if (/\s/.test(value) || /["':]/.test(value)) {
            value = `"${value}"`;
          }
        }
        newLines.push(`        ${key.trim()}: ${value}`);
      } else {
        newLines.push(line);
      }
    }
    processed = newLines.join('\n');
  }

  if (!processed.includes('requirementDiagram')) {
    processed = processed.replace(/(\s|^)'([^'\n]+)'(?=\s|$|[;,\]{}])/g, '$1"$2"');
  }

  if (processed.includes('erDiagram')) {
    processed = processed.replace(/(\w+)\s*\{([^}]+)\}/g, (_, entity, attrs) => {
      const formatted = attrs.trim().split('\n').map((l: string) => `        ${l.trim()}`).join('\n');
      return `${entity} {\n${formatted}\n    }`;
    });
  }

  if (processed.includes('quadrantChart')) {
    processed = processed.replace(/"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/g, '"$1": [$2, $3]');
    if (!/x-axis/i.test(processed)) processed = processed.replace(/^(quadrantChart\s*)/im, '$1\n  x-axis Low --> High\n');
    if (!/y-axis/i.test(processed)) processed = processed.replace(/^(quadrantChart\s*)/im, '$1\n  y-axis Low --> High\n');
  }

  if (processed.includes('gantt')) {
    if (!/dateFormat/i.test(processed)) processed = processed.replace(/^(gantt\b)/im, '$1\n  dateFormat YYYY-MM-DD');
    if (!/axisFormat/i.test(processed)) processed = processed.replace(/^(gantt\b)/im, '$1\n  axisFormat %Y-%m-%d');

    processed = processed.replace(
      /^(\s*)([^:\n]+?)\s*:\s*(?![\d-]|after|crit|done|milestone|active)([^,\n]+?)(?:,\s*([^\n]+))?$/gm,
      (_, indent, taskName, __, durationPart) => {
        const cleanTask = taskName.trim();
        const duration = (durationPart?.trim() || '7d').replace(/^\s*,\s*/, '');
        return `${indent}${cleanTask} : 2026-01-01, ${duration}`;
      }
    );
  }

  if (/^(flowchart|graph)/im.test(processed)) {
    processed = processed.replace(/^(flowchart|graph)\s+\w*/im, 'flowchart TD');
    processed = processed.replace(/->>/g, '-->');
    processed = processed.replace(/([^\n;}])\s*$/gm, '$1;');
  }

  return processed;
}
