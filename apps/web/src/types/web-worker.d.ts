// Type declarations for Web Worker modules

declare module 'web-worker:*' {
  type Listener = (event: MessageEvent) => void;
  type ErrorListener = (event: ErrorEvent) => void;

  interface WebWorker {
    onmessage: Listener | null;
    onerror: ErrorListener | null;
    postMessage(data: any): void;
    terminate(): void;
  }

  const content: {
    new (): WebWorker;
  };
  export default content;
}