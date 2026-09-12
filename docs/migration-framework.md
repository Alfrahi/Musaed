# Schema Migration Framework

## Overview

A production-grade migration framework for managing schema evolution in the Musaed desktop AI system. Supports both **Zustand persistence migrations** (frontend) and **SQLite database migrations** (Rust backend) with version tracking, rollback support, and idempotent execution.

## Architecture

```text
Migration Framework Architecture
├── Frontend (TypeScript)
│   ├── apps/web/src/lib/migrations/
│   │   ├── orchestrator.ts      # Migration execution engine
│   │   ├── index.ts             # Public API + error types
│   │   ├── versions/            # Version-specific migrations
│   │   │   ├── settings.ts
│   │   │   ├── rag.ts
│   │   │   └── model.ts
│   │   └── *.test.ts            # Unit tests
│   └── packages/contracts/src/migrations.ts  # Shared contracts
│
└── Backend (Rust)
    ├── src-tauri/src/migrations/
    │   ├── mod.rs               # Main orchestrator (run_migrations, rollback_to_version)
    │   ├── version_tracker.rs   # Version persistence
    │   ├── commands.rs          # Tauri IPC commands
    │   ├── service.rs           # Async thin-adapter service layer
    │   ├── conversations/       # Conversation DB migrations
    │   └── rag.rs               # RAG DB migrations
    └── src-tauri/src/migrations/*.test.rs  # Integration tests
```

## Design Principles

### 1. **Sequential Execution**

Migrations run in strict version order. No skipping versions ensures data transformations apply correctly.

### 2. **Transaction-Based Atomicity**

SQLite migrations execute within transactions. Failure rolls back all changes automatically.

### 3. **Bidirectional Support**

All migrations include rollback logic where safe. Non-rollbackable migrations are explicitly marked.

### 4. **Idempotent Execution**

Migrations check current version before applying. Safe to re-run without side effects.

### 5. **Version Tracking**

Dedicated metadata tables track applied migrations with timestamps and execution times.

---

## Frontend: Zustand Persistence Migrations

### Migration Contract

```typescript
interface BidirectionalMigration<T> {
  migrate: (data: T) => T;
  rollback?: (data: T) => T; // optional — only when reversible
  isRollbackable: boolean;
  description: string;
}
```

### Orchestrator API

```typescript
import {
  runMigrations,
  rollbackMigrations,
  createIdempotentMigration,
  type StoreMigrationConfig,
} from '@/lib/migrations';

// Run migrations
const result = await runMigrations(persistedState, {
  currentVersion: 3,
  migrations: settingsMigrations,
  validate: validateSettings,
  defaultState: DEFAULT_SETTINGS,
  storeName: 'settings',
});

// Rollback migrations
const rollback = await rollbackMigrations(
  data,
  3, // from version
  2, // to version
  settingsBidirectionalMigrations
);
```

`StoreMigrationConfig` fields: `currentVersion`, `migrations`, optional `bidirectionalMigrations`, `validate`, `defaultState`, `storeName`.

### Example: Settings Migration v1 → v2

Migrations are defined with `createIdempotentMigration`, which guards against re-application:

```typescript
import { createIdempotentMigration } from '@/lib/migrations/orchestrator';
import { DEFAULT_SETTINGS, type ChatSettings } from '@musaed/contracts';

// migrateSettingsToV2
export const migrateSettingsToV2 = createIdempotentMigration<ChatSettings>((data: ChatSettings) => {
  // Merge with defaults to ensure all fields exist
  const merged = { ...DEFAULT_SETTINGS, ...data };
  if (typeof merged.density !== 'number') {
    merged.density = 1.0; // New field in v2
  }
  return merged;
}, 2);

// Rollback v2 → v1
export const rollbackSettingsToV1 = (data: ChatSettings): Partial<ChatSettings> => {
  const { density: _density, ...rest } = data;
  return rest;
};
```

### Integration with Store Persistence

`apps/web/src/lib/tauri-storage.ts` runs store migrations on rehydration:

```typescript
// tauri-storage.ts
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
}
```

---

## Backend: SQLite Database Migrations

### Migration Step

```rust
pub struct MigrationStep {
    pub version: u32,
    pub description: &'static str,
    pub up: &'static [&'static str],
    pub down: Option<&'static [&'static str]>,
    pub is_rollbackable: bool,
}
```

### Orchestrator API

The core runner functions are **synchronous** and take `&mut Connection`:

```rust
use crate::migrations::{run_migrations, rollback_to_version, MigrationTarget};

// Run migrations (sync, &mut Connection)
let result = run_migrations(&mut conn, MigrationTarget::Conversations, None)?;

// Rollback (sync, &mut Connection)
let result = rollback_to_version(&mut conn, MigrationTarget::Conversations, 1)?;
```

The async service layer (`src-tauri/src/migrations/service.rs`) wraps these for the Tauri commands, taking `Arc<Mutex<ConversationStore>>`:

```rust
// service.rs — async thin adapter
pub async fn run(
    conversation_store: Arc<Mutex<ConversationStore>>,
    request: RunMigrationsRequest,
) -> ApiResponse<RunMigrationsResponse>;
```

### Example: Conversation DB Migration v2

The conversations database is currently at **version 7** (`LATEST_VERSION` in `src-tauri/src/migrations/conversations/mod.rs`). Migration v2 adds performance indexes:

```rust
2 => Some(MigrationStep::new(
    2,
    "Add performance indexes",
    &[
        "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
         ON conversations(updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_messages_timestamp
         ON messages(timestamp)",
    ],
    &[
        "DROP INDEX IF EXISTS idx_conversations_updated_at",
        "DROP INDEX IF EXISTS idx_messages_timestamp",
    ],
)),
```

### Version Tracking Table

The version table is named `_<target>_migrations` (e.g. `_conversations_migrations`) and includes a `checksum` column:

```sql
CREATE TABLE IF NOT EXISTS _conversations_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    execution_time_ms INTEGER DEFAULT 0,
    checksum TEXT
);
```

---

## IPC Commands

### Frontend → Backend

All four migration commands are wired into the typed IPC bridge as `migrationApi` (`apps/web/src/lib/ipc/migration.ts`). Direct `invoke()` calls bypass the typed bridge and are blocked by ESLint — always go through `migrationApi`:

```typescript
import { migrationApi } from '@/lib/ipc';

// Run pending migrations on the conversations database
const result = await migrationApi.run({
  target: 'conversations',
  targetVersion: undefined, // omit to apply all pending up to latest
  allowRollback: true,
});

// Roll back to a specific version
const rollbackResult = await migrationApi.rollback('conversations', 2);

// Check migration status (used by the Settings/Diagnostics panel)
const status = await migrationApi.status('conversations');
// → { target, currentVersion, latestVersion, needsMigration }

// List the available migration steps for a target
const steps = await migrationApi.list('conversations');
// → Array<{ version, description, isRollbackable }>
```

The four backend commands are `cmd_run_migrations`, `cmd_rollback_migrations`, `cmd_get_migration_status`, and `cmd_list_migrations`.

### Command Responses

```typescript
interface RunMigrationsResponse {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  appliedMigrations: number[];
  error?: { code: string; message: string };
}

interface MigrationStatus {
  target: 'conversations';
  currentVersion: number;
  latestVersion: number;
  needsMigration: boolean;
}

interface MigrationInfo {
  version: number;
  description: string;
  isRollbackable: boolean;
}
```

The contract types and Zod schemas live in `packages/contracts/src/migrations.ts` (`RunMigrationsRequestSchema`, `RunMigrationsResponseSchema`, `MigrationStatusSchema`, `MigrationInfoSchema`) and are the single source of truth. Rust serde structs mirror these names via `#[serde(rename_all = "camelCase")]`. Note: the contract's `MigrationStatusSchema` declares an optional `lastMigratedAt`, but the Rust `MigrationStatus` struct does **not** serialize it — the wire response omits that field.

---

## Error Handling

### Frontend Error Codes

The frontend `MigrationErrorCode` enum (in `packages/contracts/src/migrations.ts`):

| Code                         | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `MIGRATION_VALIDATION_ERROR` | Data failed validation against target schema |
| `MIGRATION_FAILED`           | Migration function threw                     |
| `INVALID_VERSION_SEQUENCE`   | Cannot migrate v2 → v5 (skipping)            |
| `MISSING_MIGRATION`          | No migration found for version               |
| `ROLLBACK_FAILED`            | Rollback function threw                      |
| `DATA_CORRUPTED`             | Data corrupted or unreadable                 |

### Backend Error Handling

The backend maps all migration failures to a single `MIGRATION_ERROR` code (`error_codes::MIGRATION_ERROR`). The service layer returns `ApiResponse` with a `BackendError` carrying that code and a message.

### Error Recovery Pattern

```typescript
const result = await runMigrations(persistedState, config);

if (!result.success) {
  switch (result.error?.code) {
    case MigrationErrorCode.MIGRATION_FAILED:
      // Attempt rollback
      await rollbackMigrations(result.fromVersion, result.toVersion);
      break;
    case MigrationErrorCode.MIGRATION_VALIDATION_ERROR:
      // Data corrupted - restore from backup
      await restoreFromBackup();
      break;
  }
}
```

---

## Testing Strategy

### Frontend Tests (Vitest)

```typescript
// orchestrator tests
describe('runMigrations', () => {
  it('should apply migrations sequentially', async () => { ... });
  it('should fail when migration function is missing', async () => { ... });
  it('should fail when migrated data fails validation', async () => { ... });
});

// rollback tests
describe('rollbackMigrations', () => {
  it('should rollback from v2 to v1 successfully', async () => { ... });
  it('should fail when migration is not rollbackable', async () => { ... });
});
```

### Backend Tests (Cargo)

```rust
#[test]
fn test_run_migrations_from_scratch() {
    let mut conn = create_test_db(MigrationTarget::Conversations);
    let result = run_migrations(&mut conn, MigrationTarget::Conversations, None);
    assert_eq!(result.applied_migrations, vec![1, 2]);
}

#[test]
fn test_idempotent_migration() {
    // Run twice - should succeed both times
    let _ = run_migrations(&mut conn, MigrationTarget::Conversations, None);
    let result = run_migrations(&mut conn, MigrationTarget::Conversations, None);
    assert_eq!(result.applied_migrations.len(), 0);
}
```

---

## Creating New Migrations

### Frontend (Zustand Store)

1. **Create migration file**: `apps/web/src/lib/migrations/versions/<store>.ts`

2. **Define migration**:

```typescript
export const migrateStoreToV3 = createIdempotentMigration<StoreV3>((data) => {
  // Transform v2 → v3
  return { ...data, newField: defaultValue };
}, 3);

export const rollbackStoreToV2 = (data: StoreV3): Partial<StoreV2> => {
  // Transform v3 → v2 (or identity if safe)
  const { newField, ...rest } = data;
  return rest;
};
```

3. **Register in orchestrator**: Add to the migrations object with version number
4. **Update version constant**: Increment `<STORE>_VERSION`
5. **Add tests**: Verify forward + rollback behavior

### Backend (SQLite Database)

1. **Create migration module**: `src-tauri/src/migrations/<domain>/mod.rs`

2. **Define migration**:

```rust
pub fn get_migration(version: u32) -> Option<MigrationStep> {
    match version {
        3 => Some(MigrationStep::new(
            3,
            "Add status column to chunks",
            &[
                "ALTER TABLE chunks ADD COLUMN status TEXT NOT NULL DEFAULT 'indexed'",
                "UPDATE chunks SET status = 'indexed'",
            ],
            &[
                // Cannot DROP COLUMN in SQLite < 3.35
                // Mark as non-rollbackable or use temp table approach
            ],
        )),
        _ => None,
    }
}
```

3. **Update `LATEST_VERSION`**: Increment constant
4. **Register in parent module**: Add to `get_migration()` match in `mod.rs`
5. **Add tests**: Verify SQL executes correctly, rollback safe

---

## Rollback Safety

### Safe Rollbacks ✅

- Adding nullable columns
- Creating indexes
- Adding tables
- Renaming columns (with data copy)

### Unsafe Rollbacks ❌

- Dropping columns with data
- Changing column types with incompatible data
- Removing tables with dependencies
- Data transformations that lose fidelity

---

## Observability

Migration activity is logged through the structured logging system (`crate::logging` / `emit_trace`). The version tracking table records each applied migration:

```sql
SELECT version, description, applied_at, execution_time_ms
FROM _conversations_migrations
ORDER BY version DESC;
```

---

## Versioning Rules

1. **Breaking schema changes** → Increment version
2. **Sequential only** → No skipping versions
3. **Idempotent** → Safe to re-run
4. **Tested** → Forward + rollback tests required
5. **Documented** → Description in migration metadata

---

## Checklist for Migration Author

- [ ] Migration function transforms data correctly
- [ ] Rollback function exists and is safe (or marked non-rollbackable)
- [ ] Zod/schema validation passes post-migration
- [ ] Tests cover: forward, rollback, idempotency, failure modes
- [ ] Description explains what changed and why
- [ ] Version constant incremented
- [ ] Migration registered in orchestrator
- [ ] IPC commands updated if new target database added

---

## CI Validation

Migration correctness is currently guarded by the project's unit and integration tests (frontend Vitest + Rust `cargo test`), which cover forward, rollback, and idempotency behavior. There is no dedicated migration-specific CI step in `.github/workflows/ci.yml`; the general `validate` and `rust` jobs run the test suites that exercise the migration framework.

---

## Related Documentation

- [Zustand Persistence](./state-management.md)
- [SQLite Database Layer](./rust-backend-architecture.md)
- [Error Handling](./error-handling.md)
- [Testing Requirements](./testing-requirements.md)
