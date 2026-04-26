// workerUtils.ts
// Utility functions for Web Worker communication

interface WorkerRequest {
  type: 'stripRedactedThinkingBlocks' | 'markdownProcessing';
  payload: any;
}

interface WorkerResponse {
  result: any;
  error?: string;
}

/**
 * Creates a Web Worker from a Blob URL.
 * @returns A new Web Worker instance.
 */
function createWebWorker(): Worker {
  const workerCode = `
    self.onmessage = async (event) => {
      const { type, payload } = event.data;
      let result;
      try {
        switch (type) {
          case 'stripRedactedThinkingBlocks':
            result = stripRedactedThinkingBlocks(payload.content);
            break;
          case 'markdownProcessing':
            result = await markdownProcessing(payload.content);
            break;
          default:
            throw new Error('Unknown computation type');
        }
        self.postMessage({ result });
      } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    };

    function stripRedactedThinkingBlocks(content) {
      return content.replace(/<redacted-thinking>.*?<\/redacted-thinking>/gs, '');
    }

    async function markdownProcessing(content) {
      return content;
    }
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
async function sendWorkerRequest(request: WorkerRequest): Promise<any> {
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
 * @param content The content to process.
 * @returns A promise that resolves with the processed content.
 */
export async function stripRedactedThinkingBlocksWorker(content: string): Promise<string> {
  return sendWorkerRequest({
    type: 'stripRedactedThinkingBlocks',
    payload: { content },
  });
}

/**
 * Processes Markdown content using a Web Worker.
 * @param content The content to process.
 * @returns A promise that resolves with the processed content.
 */
export async function markdownProcessingWorker(content: string): Promise<string> {
  return sendWorkerRequest({
    type: 'markdownProcessing',
    payload: { content },
  });
}