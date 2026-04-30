"use client";

import { StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { checkIsTauri, store } from './ipc';
import { logger } from './logger';

// Sync this version with breaking schema changes; prevents data corruption across client updates
const CURRENT_STORE_VERSION = 2;
const VERSION_KEY = '__musaed_store_v2_version';

interface StorageData {
  conversations?: Array<{
    messages: Array<{
      done?: boolean;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Minimal interface for a Tauri Store instance used during migrations.
 */
interface TauriStoreLike {
  get: <T>(key: string) => Promise<T | undefined | null>;
  set: (key: string, val: unknown) => Promise<void>;
  save: () => Promise<void>;
  delete: (key: string) => Promise<boolean>;
}

const migrations: Record<number, (data: StorageData) => StorageData> = {
  1: (data) => data,
  2: (data) => {
    // Migration 2 ensures all existing messages have the 'done' property for consistent streaming UI state
    if (data.conversations) {
      data.conversations = data.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({ ...m, done: m.done ?? true }))
      }));
    }
    return data;
  },
};

/**
 * Runs sequential migrations on stored data to maintain schema integrity.
 * 
 * @param {string} filename - The store filename.
 * @param {TauriStoreLike} appStore - The Tauri store instance.
 * @param {string} storageKey - The key within the store to migrate.
 */
async function runMigrations(filename: string, appStore: TauriStoreLike, storageKey: string): Promise<void> {
  try {
    const rawVersion = await appStore.get<number>(VERSION_KEY);
    const storedVersion = z.number().catch(0).parse(rawVersion);

    if (storedVersion < CURRENT_STORE_VERSION) {
      const rawData = await appStore.get<string>(storageKey);
      if (!rawData) {
        await appStore.set(VERSION_KEY, CURRENT_STORE_VERSION);
        await appStore.save();
        return;
      }

      let migratedData = (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) as StorageData;
      let currentV = storedVersion;

      // Sequential application of migrations guarantees schema integrity
      while (currentV < CURRENT_STORE_VERSION) {
        currentV++;
        if (migrations[currentV]) {
          migratedData = migrations[currentV](migratedData);
        }
      }

      await appStore.set(storageKey, JSON.stringify(migratedData));
      await appStore.set(VERSION_KEY, CURRENT_STORE_VERSION);
      await appStore.save();
    }
  } catch (err) {
    logger.error(`Migration failed for ${filename}`, { error: err });
  }
}

/**
 * Creates a Zustand-compatible storage engine that utilizes Tauri's secure storage plugin.
 * Falls back to localStorage in non-Tauri environments.
 * 
 * @param {string} filename - The target JSON file for the store.
 * @returns {StateStorage} A storage implementation for Zustand.
 */
export const createTauriStorage = (filename: string): StateStorage => ({
  getItem: async (name: string): Promise<string | null> => {
    if (!checkIsTauri()) return localStorage.getItem(name);
    try {
      const appStore = await store.load(filename, { autoSave: true }) as TauriStoreLike | null;
      if (!appStore) return null;
      await runMigrations(filename, appStore, name);
      const value = await appStore.get<string>(name);
      return value !== undefined && value !== null ? value : null;
    } catch (_err) {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!checkIsTauri()) {
      localStorage.setItem(name, value);
      return;
    }
    try {
      const appStore = await store.load(filename, { autoSave: true }) as TauriStoreLike | null;
      if (!appStore) return;
      await appStore.set(name, value);
      await appStore.save();
    } catch (err) {
      logger.error(`Save error: ${filename}`, { error: err });
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!checkIsTauri()) {
      localStorage.removeItem(name);
      return;
    }
    const appStore = await store.load(filename, { autoSave: true }) as TauriStoreLike | null;
    if (appStore) {
      await appStore.delete(name);
      await appStore.save();
    }
  },
});