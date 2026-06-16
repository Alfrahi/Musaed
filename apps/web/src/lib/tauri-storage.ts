'use client';

import { type StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { checkIsTauri, store } from './ipc';
import { logger } from './logger';
import {
  runMigrations as runStoreMigrations,
  type MigrationFn,
  type MigrationResult,
  MigrationError,
  MigrationErrorCode,
} from './migrations';

export type { MigrationFn };

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
 * Runs sequential migrations on stored data with enhanced error handling and logging.
 * Uses the new migration framework for better tracking and rollback support.
 */
async function runMigrations(
  filename: string,
  appStore: TauriStoreLike,
  storageKey: string,
  currentVersion: number,
  migrations?: Record<number, MigrationFn>
): Promise<MigrationResult<unknown>> {
  const versionKey = `__musaed_store_version_${filename}`;

  try {
    const rawVersion = await appStore.get<number>(versionKey);
    const storedVersion = z.number().catch(0).parse(rawVersion);

    // No migration needed
    if (storedVersion >= currentVersion) {
      logger.debug(`[${filename}] Already at version ${currentVersion}`);
      return {
        success: true,
        fromVersion: storedVersion,
        toVersion: currentVersion,
      };
    }

    logger.info(`[${filename}] Migrating from v${storedVersion} to v${currentVersion}`);

    const rawData = await appStore.get<string>(storageKey);
    if (!rawData) {
      logger.debug(`[${filename}] No data to migrate, initializing at v${currentVersion}`);
      await appStore.set(versionKey, currentVersion);
      await appStore.save();
      return {
        success: true,
        fromVersion: 0,
        toVersion: currentVersion,
      };
    }

    const parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

    // Use the new migration framework
    const result = await runStoreMigrations(parsedData, {
      currentVersion,
      migrations: migrations ?? {},
      validate: (data: unknown) => data,
      defaultState: {},
      storeName: filename,
    });

    if (result.success && result.data) {
      await appStore.set(storageKey, JSON.stringify(result.data));
      await appStore.set(versionKey, result.toVersion);
      await appStore.save();
      logger.info(
        `[${filename}] Migration successful: v${result.fromVersion} → v${result.toVersion}`
      );
    } else if (result.error) {
      logger.error(`[${filename}] Migration failed`, {
        error: result.error.toJSON?.() ?? result.error.message,
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
      });
    }

    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(`[${filename}] Migration system error`, {
      error: error.message,
      stack: error.stack,
    });
    return {
      success: false,
      fromVersion: 0,
      toVersion: currentVersion,
      error: new MigrationError(
        MigrationErrorCode.MIGRATION_FAILED,
        0,
        currentVersion,
        `Migration system error: ${error.message}`,
        err
      ),
    };
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
  migrations?: Record<number, MigrationFn>
): StateStorage => ({
  getItem: async (name: string): Promise<string | null> => {
    if (!checkIsTauri()) {
      // Dev-only fallback; no sensitive data stored per security review
      return localStorage.getItem(name);
    }
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
      // Dev-only fallback; no sensitive data stored per security review
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
      // Dev-only fallback; no sensitive data stored per security review
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
