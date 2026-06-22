import { isValidOllamaUrl, checkIsTauri } from '@/lib/ipc';

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

export interface OllamaHealth {
  is_running: boolean;
  version?: string;
  responseTimeMs: number;
}

export interface ConnectionManagerConfig {
  baseUrl: string;
  healthCheckIntervalMs?: number;
  /** When set (e.g. Tauri IPC), used instead of `fetch` so health checks align with backend URL policy and CSP. */
  healthCheck?: (baseUrl: string) => Promise<OllamaHealth | null>;
}

export class OllamaConnectionManager {
  private baseUrl: string;
  private healthCheckIntervalMs: number;
  private healthCheck?: (baseUrl: string) => Promise<OllamaHealth | null>;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private intervalId: NodeJS.Timeout | null = null;
  private listeners: ((state: ConnectionState, health?: OllamaHealth) => void)[] = [];

  constructor(config: ConnectionManagerConfig) {
    this.baseUrl = config.baseUrl;
    this.healthCheckIntervalMs = config.healthCheckIntervalMs || 30000;
    this.healthCheck = config.healthCheck;
  }

  subscribe(callback: (state: ConnectionState, health?: OllamaHealth) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  async checkHealth(): Promise<OllamaHealth | null> {
    if (!isValidOllamaUrl(this.baseUrl)) {
      this.setState(ConnectionState.ERROR);
      return null;
    }

    // Tauri WebView CSP does not allow arbitrary LAN `fetch` to Ollama; health must use IPC.
    if (checkIsTauri() && !this.healthCheck) {
      this.setState(ConnectionState.ERROR);
      return null;
    }

    if (this.healthCheck) {
      try {
        const h = await this.healthCheck(this.baseUrl);
        if (h?.is_running) {
          this.setState(ConnectionState.CONNECTED, h);
          return h;
        }
        this.setState(ConnectionState.DISCONNECTED, h ?? undefined);
        return h;
      } catch {
        this.setState(ConnectionState.DISCONNECTED);
        return null;
      }
    }

    try {
      const start = Date.now();
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        cache: 'no-cache',
      });

      const responseTimeMs = Date.now() - start;

      if (res.ok) {
        const health: OllamaHealth = { is_running: true, responseTimeMs };
        this.setState(ConnectionState.CONNECTED, health);
        return health;
      }
      this.setState(ConnectionState.ERROR);
      return null;
    } catch {
      this.setState(ConnectionState.DISCONNECTED);
      return null;
    }
  }

  startHealthChecks() {
    if (this.intervalId) return;

    void this.checkHealth();

    this.intervalId = setInterval(() => {
      void this.checkHealth();
    }, this.healthCheckIntervalMs);
  }

  stopHealthChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private setState(newState: ConnectionState, health?: OllamaHealth) {
    this.state = newState;
    this.listeners.forEach((cb) => cb(newState, health));
  }
}

export const getConnectionManager = (config: ConnectionManagerConfig) => {
  return new OllamaConnectionManager(config);
};
