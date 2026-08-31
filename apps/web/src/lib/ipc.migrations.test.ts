import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri core API before importing the bridge so we can intercept invoke.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Opt out of the global ipc mock so we can test the real implementation.
vi.unmock('@/lib/ipc');

import { invoke } from '@tauri-apps/api/core';
import { migrationApi } from '@/lib/ipc';

describe('migrationApi', () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: () => undefined };
    (invoke as unknown as { mockReset: () => void }).mockReset();
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it('run() invokes cmd_run_migrations with the typed payload', async () => {
    const response = {
      success: true,
      fromVersion: 1,
      toVersion: 3,
      appliedMigrations: [2, 3],
    };
    vi.mocked(invoke).mockResolvedValue({ success: true, data: response });

    const result = await migrationApi.run({
      target: 'conversations',
      targetVersion: undefined,
      allowRollback: true,
    });

    expect(invoke).toHaveBeenCalledWith('cmd_run_migrations', {
      target: 'conversations',
      targetVersion: undefined,
      allowRollback: true,
    });
    expect(result).toEqual(response);
  });

  it('run() forwards explicit targetVersion when provided', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      data: { success: true, fromVersion: 3, toVersion: 3, appliedMigrations: [] },
    });

    await migrationApi.run({
      target: 'conversations',
      targetVersion: 3,
      allowRollback: false,
    });

    expect(invoke).toHaveBeenCalledWith('cmd_run_migrations', {
      target: 'conversations',
      targetVersion: 3,
      allowRollback: false,
    });
  });

  it('rollback() invokes cmd_rollback_migrations with target + toVersion', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      data: { success: true, fromVersion: 3, toVersion: 2, appliedMigrations: [3] },
    });

    const result = await migrationApi.rollback('conversations', 2);

    expect(invoke).toHaveBeenCalledWith('cmd_rollback_migrations', {
      target: 'conversations',
      toVersion: 2,
    });
    expect(result).toEqual({
      success: true,
      fromVersion: 3,
      toVersion: 2,
      appliedMigrations: [3],
    });
  });

  it('status() invokes cmd_get_migration_status with target', async () => {
    const status = {
      target: 'conversations',
      currentVersion: 3,
      latestVersion: 3,
      needsMigration: false,
    };
    vi.mocked(invoke).mockResolvedValue({ success: true, data: status });

    const result = await migrationApi.status('conversations');

    expect(invoke).toHaveBeenCalledWith('cmd_get_migration_status', {
      target: 'conversations',
    });
    expect(result).toEqual(status);
  });

  it('list() invokes cmd_list_migrations with target', async () => {
    const steps = [
      { version: 1, description: 'initial schema', isRollbackable: true },
      { version: 2, description: 'indexes', isRollbackable: true },
    ];
    vi.mocked(invoke).mockResolvedValue({ success: true, data: steps });

    const result = await migrationApi.list('conversations');

    expect(invoke).toHaveBeenCalledWith('cmd_list_migrations', { target: 'conversations' });
    expect(result).toEqual(steps);
  });

  it('returns null when the backend reports a failure envelope', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: false,
      error: { code: 'MIGRATION_FAILED', message: 'boom' },
    });

    const result = await migrationApi.status('conversations');

    expect(result).toBeNull();
  });
});
