'use client';

import { type StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { checkIsTauri, storeApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import {
  runMigrations as runStoreMigrations,
  type MigrationFn,
  type MigrationResult,
  MigrationError,
  MigrationErrorCode,
} from '@/lib/migrations';

export type { MigrationFn };

/**
 * Runs sequential migrations on stored data with enhanced error handling and logging.
 * Uses the new migration framework for better tracking and rollback support.
 *
 * This version uses the command-based storeApi instead of the direct
 * tauri-plugin-store wrapper (STANDARDS §5, §16).
 */
async function runMigrations(
  filename: string,
  storageKey: string,
  currentVersion: number,
  migrations?: Record<number, MigrationFn>
): Promise<MigrationResult<unknown>> {
  const versionKey = `__musaed_store_version_${filename}`;

  try {
    await storeApi.load(filename);
    const rawVersion = await storeApi.get(filename, versionKey);
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

    const rawData = await storeApi.get(filename, storageKey);
    if (!rawData) {
      logger.debug(`[${filename}] No data to migrate, initializing at v${currentVersion}`);
      await storeApi.set(filename, versionKey, currentVersion);
      await storeApi.save(filename);
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
      await storeApi.set(filename, storageKey, JSON.stringify(result.data));
      await storeApi.set(filename, versionKey, result.toVersion);
      await storeApi.save(filename);
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
 * Creates a Zustand-compatible storage engine that utilizes Tauri's secure
 * store plugin via Rust commands. Falls back to localStorage in non-Tauri
 * environments.
 *
 * All store operations now route through `storeApi` (command-based IPC)
 * instead of the direct `@tauri-apps/plugin-store` wrapper. This provides
 * Zod validation, latency tracking, and error sanitization per STANDARDS
 * §5 and §16.
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
      await runMigrations(filename, name, version, migrations);
      const value = await storeApi.get(filename, name);
      if (value === null || value === undefined) return null;
      return typeof value === 'string' ? value : JSON.stringify(value);
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
      await storeApi.load(filename);
      await storeApi.set(filename, name, value);
      await storeApi.save(filename);
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
    try {
      await storeApi.load(filename);
      await storeApi.delete(filename, name);
      await storeApi.save(filename);
    } catch (err) {
      logger.error(`Remove error: ${filename}`, { error: err });
    }
  },
});
