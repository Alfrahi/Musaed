'use client';

import { StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { checkIsTauri, store } from './ipc';
import { logger } from './logger';

export type MigrationFn = (data: unknown) => unknown;
export type Migrations = Record<number, MigrationFn>;

interface StorageData {
  conversations?: Record<string, unknown> | Array<unknown>;
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

/**
 * Runs sequential migrations on stored data to maintain schema integrity.
 */
async function runMigrations(
  filename: string,
  appStore: TauriStoreLike,
  storageKey: string,
  currentVersion: number,
  migrations?: Migrations
): Promise<void> {
  try {
    const versionKey = `__musaed_store_version_${filename}`;
    const rawVersion = await appStore.get<number>(versionKey);
    const storedVersion = z.number().catch(0).parse(rawVersion);

    if (storedVersion < currentVersion) {
      const rawData = await appStore.get<string>(storageKey);
      if (!rawData) {
        await appStore.set(versionKey, currentVersion);
        await appStore.save();
        return;
      }

      let migratedData = (
        typeof rawData === 'string' ? JSON.parse(rawData) : rawData
      ) as StorageData;
      let currentV = storedVersion;

      // Sequential application of migrations guarantees schema integrity
      if (migrations) {
        while (currentV < currentVersion) {
          currentV++;
          if (migrations[currentV]) {
            migratedData = migrations[currentV](migratedData) as StorageData;
          }
        }
      }

      await appStore.set(storageKey, JSON.stringify(migratedData));
      await appStore.set(versionKey, currentVersion);
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
 * @param filename - The target JSON file for the store.
 * @param version - The current version of the store schema.
 * @param migrations - A record of migration functions.
 * @returns A storage implementation for Zustand.
 */
export const createTauriStorage = (
  filename: string,
  version: number = 1,
  migrations?: Migrations
): StateStorage => ({
  getItem: async (name: string): Promise<string | null> => {
    if (!checkIsTauri()) return localStorage.getItem(name);
    try {
      const appStore = (await store.load(filename, { autoSave: true })) as TauriStoreLike | null;
      if (!appStore) return null;
      await runMigrations(filename, appStore, name, version, migrations);
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
      const appStore = (await store.load(filename, { autoSave: true })) as TauriStoreLike | null;
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
    const appStore = (await store.load(filename, { autoSave: true })) as TauriStoreLike | null;
    if (appStore) {
      await appStore.delete(name);
      await appStore.save();
    }
  },
});
