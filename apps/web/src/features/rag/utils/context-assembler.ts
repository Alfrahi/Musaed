'use client';

import type { SearchResult } from '@musaed/contracts';

/**
 * Build a RAG system prompt context string from search results.
 * This is injected before the main system prompt in chat messages.
 */
export function buildRagSystemContext(
  results: SearchResult[],
  projectPath: string,
  maxChars: number = 20_000
): string {
  if (results.length === 0) return '';

  const header = `You have access to the following codebase context from the project at "${projectPath}". Use this information to answer the user's question. Always reference the file path and line numbers when referring to specific code.\n\n`;

  let context = header;
  let totalChars = context.length;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const langTag = result.language ? `\`${result.language}\`` : '';

    const sourceBlock = `### Source ${i + 1}: ${result.filePath} (lines ${result.startLine}-${result.endLine}) ${langTag}\n\`\`\`\n${result.content}\n\`\`\`\n\n`;

    if (totalChars + sourceBlock.length > maxChars) {
      break;
    }

    context += sourceBlock;
    totalChars += sourceBlock.length;
  }

  return context;
}
