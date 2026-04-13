"use client";

import { useEffect, useState, useCallback } from 'react';
import {
    OllamaConnectionManager,
    ConnectionState,
    OllamaHealth,
    getConnectionManager
} from '@/lib/connection-manager';
import { useSettingsStore, useUIStore } from '@/store';
import { checkIsTauri, invoke } from '@/lib/ipc';
import { OllamaHealthIpcSchema } from '@musaed/contracts';

export function useOllamaConnection() {
    const { globalSettings } = useSettingsStore();
    const { setOllamaConnected } = useUIStore();
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [health, setHealth] = useState<OllamaHealth | null>(null);
    const [manager, setManager] = useState<OllamaConnectionManager | null>(null);

    useEffect(() => {
        const healthCheck = checkIsTauri()
            ? async (baseUrl: string): Promise<OllamaHealth | null> => {
                const data = await invoke(
                    'check_ollama_health',
                    { baseUrl },
                    OllamaHealthIpcSchema,
                    { quiet: true }
                );
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

    const manualHealthCheck = useCallback(async () => {
        if (!manager) return null;
        return await manager.checkHealth();
    }, [manager]);

    const reconnect = useCallback(async () => {
        if (!manager) return;
        setConnectionState(ConnectionState.CONNECTING);
        await manualHealthCheck();
    }, [manager, manualHealthCheck]);

    const isHealthy = connectionState === ConnectionState.CONNECTED;
    const isChecking = connectionState === ConnectionState.CONNECTING;

    return {
        connectionState,
        health,
        isHealthy,
        isChecking,
        manualHealthCheck,
        reconnect,
    };
}
