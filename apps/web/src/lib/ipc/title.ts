import { callInternal } from './transport';
import type { CommandMap } from '@musaed/contracts';

/**
 * Title Generation API - generates chat titles from conversation snippets.
 */
export const titleApi = {
  /**
   * Generates a concise title for a chat session based on the first user/assistant exchange.
   * Runs in quiet mode (no toast errors).
   * @param args - Contains baseUrl, model, userMessage, assistantMessage, and language
   * @returns Generated title string, or empty on failure
   */
  generate: (args: CommandMap['cmd_ollama_generate_title']['args']) =>
    callInternal('cmd_ollama_generate_title', args, { quiet: true }),
};
