import { callInternal } from './transport';
import type { CommandMap } from '@musaed/contracts';

/**
 * Migration API — drives backend SQLite schema migrations (conversations/rag).
 *
 * Used by the Settings/Diagnostics surface to run pending migrations, roll
 * back to a previous version, and report current state. These are the typed
 * equivalents of the four `cmd_*_migrations` Rust commands.
 */
export const migrationApi = {
  /**
   * Runs pending migrations for a target database.
   * @param args - { target, targetVersion?, allowRollback? }
   * @returns Migration result with from/to version and applied steps
   */
  run: (args: CommandMap['cmd_run_migrations']['args']) => callInternal('cmd_run_migrations', args),
  /**
   * Rolls back a target database to a previous version.
   * @param target - 'conversations'
   * @param toVersion - Target version to roll back to
   * @returns Migration result with from/to version and applied steps
   */
  rollback: (target: 'conversations', toVersion: number) =>
    callInternal('cmd_rollback_migrations', { target, toVersion }),
  /**
   * Reports current vs latest version for a target database.
   * @param target - 'conversations'
   * @returns Migration status including `needsMigration` flag
   */
  status: (target: 'conversations') => callInternal('cmd_get_migration_status', { target }),
  /**
   * Lists the available migration steps for a target database.
   * @param target - 'conversations'
   * @returns Array of migration info (version, description, isRollbackable)
   */
  list: (target: 'conversations') => callInternal('cmd_list_migrations', { target }),
};
