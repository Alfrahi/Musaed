"use client";

import { StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { checkIsTauri, store } from './ipc';
import { logger } from './logger';

// Sync this version with breaking schema changes; prevents data corruption across client updates
const CURRENT_STORE_VERSION = 2;
const VERSION_KEY = '__musaed_store_v2_version';

const migrations: Record<number, (data: any) => any> = {
  1: (data) => data,
  2: (data) => {
    // Migration 2 ensures all existing messages have the 'done' property for consistent streaming UI state
    if (data.conversations) {
      data.conversations = data.conversations.map((c: any) => ({
        ...c,
        messages: c.messages.map((m: any) => ({ ...m, done: m.done ?? true }))
      }));
    }
    return data;
  },
};

async function runMigrations(filename: string, appStore: any, storageKey: string): Promise<void> {
  try {
    const rawVersion = await appStore.get(VERSION_KEY);
    const storedVersion = z.number().catch(0).parse(rawVersion);

    if (storedVersion < CURRENT_STORE_VERSION) {
      const rawData = await appStore.get(storageKey);
      if (!rawData) {
        await appStore.set(VERSION_KEY, CURRENT_STORE_VERSION);
        await appStore.save();
        return;
      }

      let migratedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
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

export const createTauriStorage = (filename: string): StateStorage => ({
  getItem: async (name: string): Promise<string | null> => {
    if (!checkIsTauri()) return localStorage.getItem(name);
    try {
      const appStore = await store.load(filename, { autoSave: true });
      if (!appStore) return null;
      await runMigrations(filename, appStore, name);
      const value = await appStore.get<string>(name);
      return value !== undefined ? value : null;
    } catch (err) {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!checkIsTauri()) {
      localStorage.setItem(name, value);
      return;
    }
    try {
      const appStore = await store.load(filename, { autoSave: true });
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
    const appStore = await store.load(filename, { autoSave: true });
    if (appStore) {
      await appStore.delete(name);
      await appStore.save();
    }
  },
});