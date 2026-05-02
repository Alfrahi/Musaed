// workerUtils.ts
// Utility functions for Web Worker communication.
// The worker blob is built from shared constants to prevent regex drift.

import {
  REDACTED_THINKING_REGEX_SOURCE,
  stripRedactedThinkingBlocks,
} from './redactedThinking';

interface WorkerRequest {
  type: 'stripRedactedThinkingBlocks' | 'markdownProcessing';
  payload: { content: string };
}

interface WorkerResponse {
  result: unknown;
  error?: string;
}

/**
 * Creates a self-contained Web Worker from a Blob URL.
 *
 * The regex pattern is injected from the shared `REDACTED_THINKING_REGEX_SOURCE`
 * so the worker always uses the same logic as the synchronous path — no duplicated patterns.
 */
function createWebWorker(): Worker {
  const workerCode = `
    self.onmessage = async (event) => {
      const { type, payload } = event.data;
      let result;
      try {
        switch (type) {
          case 'stripRedactedThinkingBlocks':
            result = payload.content.replace(new RegExp(${JSON.stringify(REDACTED_THINKING_REGEX_SOURCE)}, 'gi'), '').trim();
            break;
          case 'markdownProcessing':
            result = payload.content;
            break;
          default:
            throw new Error('Unknown computation type');
        }
        self.postMessage({ result });
      } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  return new Worker(url);
}

/**
 * Sends a computation request to the centralized Web Worker.
 * @param request The request to send to the Web Worker.
 * @returns A promise that resolves with the result of the computation.
 */
async function sendWorkerRequest(request: WorkerRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = createWebWorker();
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as WorkerResponse;
      if (data.error) {
        reject(new Error(data.error));
      } else {
        resolve(data.result);
      }
      worker.terminate();
    };
    worker.onerror = (event: ErrorEvent) => {
      reject(new Error(event.message));
      worker.terminate();
    };
    worker.postMessage(request);
  });
}

/**
 * Strips redacted thinking blocks from content using a Web Worker.
 * Falls back to the synchronous `stripRedactedThinkingBlocks` if the worker fails.
 * @param content The content to process.
 * @returns A promise that resolves with the processed content.
 */
export async function stripRedactedThinkingBlocksWorker(content: string): Promise<string> {
  try {
    const result = await sendWorkerRequest({
      type: 'stripRedactedThinkingBlocks',
      payload: { content },
    });
    return result as string;
  } catch {
    // Worker unavailable — use the identical synchronous path
    return stripRedactedThinkingBlocks(content);
  }
}

/**
 * Processes Markdown content using a Web Worker.
 * @param content The content to process.
 * @returns A promise that resolves with the processed content.
 */
export async function markdownProcessingWorker(content: string): Promise<string> {
  const result = await sendWorkerRequest({
    type: 'markdownProcessing',
    payload: { content },
  });
  return result as string;
}
