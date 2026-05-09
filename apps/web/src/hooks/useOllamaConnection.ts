'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  type OllamaConnectionManager,
  ConnectionState,
  type OllamaHealth,
  getConnectionManager,
} from '@/lib/connection-manager';
import { useSettingsStore } from '@/store';
import { useSetOllamaConnected } from '@/store/hooks';
import { checkIsTauri, ollamaApi } from '@/lib/ipc';

/**
 * Hook to manage and monitor the connection state with the local Ollama server.
 * It initializes an {@link OllamaConnectionManager} and keeps it in sync with
 * the global settings' `ollamaUrl`. It also updates the global connected state.
 *
 * @returns An object containing the current connection state, health info, booleans,
 * and action callbacks.
 */
export function useOllamaConnection() {
  const { globalSettings } = useSettingsStore();
  const setOllamaConnected = useSetOllamaConnected();
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.DISCONNECTED
  );
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [manager, setManager] = useState<OllamaConnectionManager | null>(null);

  useEffect(() => {
    const healthCheck = checkIsTauri()
      ? async (baseUrl: string): Promise<OllamaHealth | null> => {
          const data = await ollamaApi.checkHealth(baseUrl);
          if (!data) return null;
          return {
            is_running: data.isRunning,
            version: data.version ?? undefined,
            responseTimeMs: data.responseTimeMs,
          };
        }
      : undefined;

    const connectionManager = getConnectionManager({
      baseUrl: globalSettings.ollamaUrl,
      healthCheckIntervalMs: 30000,
      healthCheck,
    });

    setManager(connectionManager);

    const unsubscribe = connectionManager.subscribe((state, healthData) => {
      setConnectionState(state);
      setHealth(healthData ?? null);
      setOllamaConnected(state === ConnectionState.CONNECTED);
    });

    connectionManager.startHealthChecks();

    return () => {
      unsubscribe();
      connectionManager.stopHealthChecks();
    };
  }, [globalSettings.ollamaUrl, setOllamaConnected]);

  /**
   * Triggers a one-off manual health check and returns the result.
   * @returns The health data if available, otherwise null.
   */
  const manualHealthCheck = useCallback(async () => {
    if (!manager) return null;
    return await manager.checkHealth();
  }, [manager]);

  /**
   * Forces a reconnection attempt by setting state to CONNECTING and running a health check.
   */
  const reconnect = useCallback(async () => {
    if (!manager) return;
    setConnectionState(ConnectionState.CONNECTING);
    await manualHealthCheck();
  }, [manager, manualHealthCheck]);

  const isHealthy = connectionState === ConnectionState.CONNECTED;
  const isChecking = connectionState === ConnectionState.CONNECTING;

  return {
    /** Current connection state (DISCONNECTED, CONNECTING, CONNECTED, ERROR). */
    connectionState,
    /** Latest health data from the server (version, response time, etc.). */
    health,
    /** Derived: true if fully connected. */
    isHealthy,
    /** Derived: true if currently checking health. */
    isChecking,
    /** Function to manually trigger a health check. */
    manualHealthCheck,
    /** Function to force a reconnection attempt. */
    reconnect,
  };
}
