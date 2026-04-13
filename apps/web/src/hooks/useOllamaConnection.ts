"use client";

import { useEffect, useState, useCallback } from 'react';
import {
    OllamaConnectionManager,
    ConnectionState,
    OllamaHealth,
    getConnectionManager
} from '@/lib/connection-manager';
import { useSettingsStore, useUIStore } from '@/store';

export function useOllamaConnection() {
    const { globalSettings } = useSettingsStore();
    const { setOllamaConnected } = useUIStore();
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [health, setHealth] = useState<OllamaHealth | null>(null);
    const [manager, setManager] = useState<OllamaConnectionManager | null>(null);

    // Initialize connection manager
    useEffect(() => {
        const connectionManager = getConnectionManager({
            baseUrl: globalSettings.ollamaUrl,
            healthCheckIntervalMs: 30000,
        });

        setManager(connectionManager);

        // Subscribe to connection state changes
        const unsubscribe = connectionManager.subscribe((state, healthData) => {
            setConnectionState(state);
            setHealth(healthData || null);
            setOllamaConnected(state === ConnectionState.CONNECTED);
        });

        // Start health checks
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
