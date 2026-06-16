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
│   │   │   ├── settings-migrations.ts
│   │   │   ├── rag-migrations.ts
│   │   │   └── model-migrations.ts
│   │   └── migrations.test.ts   # Unit tests
│   └── packages/contracts/src/migrations.ts  # Shared contracts
│
└── Backend (Rust)
    ├── src-tauri/src/migrations/
    │   ├── mod.rs               # Main orchestrator
    │   ├── traits.rs            # Migration trait definitions
    │   ├── version_tracker.rs   # Version persistence
    │   ├── rollback.rs          # Rollback planning
    │   ├── commands.rs          # Tauri IPC commands
    │   └── migrations/          # Database-specific migrations
    │       ├── conversations/   # Conversation DB migrations
    │       └── rag/            # RAG DB migrations
    └── src-tauri/src/migrations/mod.rs tests  # Integration tests
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
  rollback: (data: T) => T;
  isRollbackable: boolean;
  description: string;
}
```

### Orchestrator API

```typescript
// Run migrations
const result = await runMigrations(persistedState, {
  currentVersion: 2,
  migrations: settingsMigrations,
  validate: validateSettings,
  defaultState: DEFAULT_SETTINGS,
  storeName: 'settings',
});

// Rollback migrations
const rollback = await rollbackMigrations(
  data,
  2, // from version
  1, // to version
  settingsBidirectionalMigrations
);
```

### Example: Settings Migration v1 → v2

```typescript
// migrateSettingsToV2
export const migrateSettingsToV2 = (data: any): ChatSettings => {
  if (isSettingsV2(data)) return data; // Idempotent guard

  const v1Data = SettingsV1Schema.parse(data);
  return {
    ...v1Data,
    density: 1.0, // New field in v2
  };
};

// Rollback
export const rollbackSettingsToV1 = (data: any): SettingsV1 => {
  const { density, ...rest } = data;
  return SettingsV1Schema.parse(rest);
};
```

### Integration with Store Persistence

```typescript
// tauri-storage.ts
const transformed = await runStoreMigrations(parsed.content, {
  currentVersion: SETTINGS_VERSION,
  migrations: settingsMigrations,
  validate: validateSettings,
  defaultState: DEFAULT_SETTINGS,
  storeName: 'settings',
});

if (transformed.success) {
  await saveStore(path, {
    version: transformed.toVersion,
    data: transformed.data,
  });
}
```

---

## Backend: SQLite Database Migrations

### Migration Trait

```rust
pub trait DatabaseMigration: Send + Sync {
    fn version(&self) -> u32;
    fn description(&self) -> &'static str;
    fn up(&self) -> &'static [&'static str];
    fn down(&self) -> Option<&'static [&'static str]>;
    fn is_rollbackable(&self) -> bool { true }
}
```

### Orchestrator API

```rust
// Run migrations
let result = run_migrations(
    conn.clone(),
    MigrationTarget::Conversations,
    None  // None = latest version
).await?;

// Rollback
let result = rollback_to_version(
    conn.clone(),
    MigrationTarget::Conversations,
    1  // target version
).await?;
```

### Example: Conversation DB Migration v1 → v2

```rust
// v2: Add performance indexes
pub fn get_migration(version: u32) -> Option<MigrationStep> {
    match version {
        2 => Some(MigrationStep::new(
            2,
            "Add performance indexes",
            &[
                "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
                 ON conversations(updated_at)",
                "CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
                 ON messages(conversation_id)",
            ],
            &[
                "DROP INDEX IF EXISTS idx_conversations_updated_at",
                "DROP INDEX IF EXISTS idx_messages_conversation_id",
            ],
        )),
        _ => None,
    }
}
```

### Version Tracking Table

```sql
CREATE TABLE IF NOT EXISTS _conversations_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    execution_time_ms INTEGER DEFAULT 0
);
```

---

## IPC Commands

### Frontend → Backend

```typescript
// Run migrations
const result = await ipc.invoke('run_migrations', {
  target: 'conversations',
  targetVersion: null, // or specific version
  allowRollback: true,
});

// Get rollback plan (dry-run)
const plan = await ipc.invoke('get_rollback_plan', {
  target: 'rag',
  toVersion: 2,
});

// Check migration status
const status = await ipc.invoke('get_migration_status', {
  target: 'conversations',
});
```

### Command Responses

```typescript
interface RunMigrationsResponse {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  appliedMigrations: number[];
  error?: { code: string; message: string };
}

interface RollbackPlanResponse {
  target: string;
  fromVersion: number;
  toVersion: number;
  migrationsToRollback: Array<{
    version: number;
    description: string;
    isRollbackable: boolean;
    hasDataLoss: boolean;
  }>;
  isSafe: boolean;
  warnings: string[];
  estimatedDataLoss?: string;
}
```

---

## Error Handling

### Error Codes

| Code                       | Description                       |
| -------------------------- | --------------------------------- |
| `DATABASE_ERROR`           | SQLite/rusqlite error             |
| `MIGRATION_FAILED`         | Migration function threw          |
| `ROLLBACK_FAILED`          | Rollback function threw           |
| `MISSING_MIGRATION`        | No migration found for version    |
| `INVALID_VERSION_SEQUENCE` | Cannot migrate v2 → v5 (skipping) |
| `NOT_ROLLBACKABLE`         | Migration explicitly irreversible |
| `VALIDATION_ERROR`         | Post-migration validation failed  |

### Error Recovery Pattern

```typescript
const result = await runMigrations(persistedState, config);

if (!result.success) {
  switch (result.error?.code) {
    case MigrationErrorCode.MIGRATION_FAILED:
      // Attempt rollback
      await rollbackMigrations(result.fromVersion, result.toVersion);
      break;
    case MigrationErrorCode.VALIDATION_ERROR:
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
#[tokio::test]
async fn test_run_migrations_from_scratch() {
    let conn = create_test_db(MigrationTarget::Conversations);
    let result = run_migrations(conn, MigrationTarget::Conversations, None).await;
    assert_eq!(result.applied_migrations, vec![1, 2]);
}

#[tokio::test]
async fn test_idempotent_migration() {
    // Run twice - should succeed both times
    let _ = run_migrations(conn.clone(), MigrationTarget::Conversations, None).await;
    let result = run_migrations(conn.clone(), MigrationTarget::Conversations, None).await;
    assert_eq!(result.applied_migrations.len(), 0);
}
```

---

## Creating New Migrations

### Frontend (Zustand Store)

1. **Create migration file**: `apps/web/src/lib/migrations/versions/<store>-migrations.ts`

2. **Define migration**:

```typescript
export const migrateStoreToV3 = (data: any): StoreV3 => {
  // Transform v2 → v3
  return { ...data, newField: defaultValue };
};

export const rollbackStoreToV2 = (data: any): StoreV2 => {
  // Transform v3 → v2 (or identity if safe)
  const { newField, ...rest } = data;
  return rest as StoreV2;
};
```

3. **Register in orchestrator**: Add to migrations object with version number

4. **Update version constant**: Increment `<STORE>_VERSION`

5. **Add tests**: Verify forward + rollback behavior

### Backend (SQLite Database)

1. **Create migration module**: `src-tauri/src/migrations/migrations/<domain>/mod.rs`

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

3. **Update LATEST_VERSION**: Increment constant

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

### Rollback Planning

Before rollback, request a plan:

```typescript
const plan = await ipc.invoke('get_rollback_plan', {
  target: 'rag',
  toVersion: 2,
});

if (!plan.isSafe) {
  console.warn('Rollback warnings:', plan.warnings);
  console.warn('Estimated data loss:', plan.estimatedDataLoss);
}
```

---

## Observability

### Structured Logging

```rust
tracing::info!(
    target = target.as_str(),
    from = from_version,
    to = target_version,
    "Starting migration"
);

tracing::info!(
    target = target.as_str(),
    version = next_version,
    description = migration.description,
    "Applied migration"
);
```

### Migration History Query

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

Migration files are validated by CI for:

- ✅ Sequential version numbers
- ✅ Bidirectional migrations have rollback (or marked non-rollbackable)
- ✅ Description present
- ✅ Tests exist and pass
- ✅ No contract mismatches between frontend/backend

---

## Related Documentation

- [Zustand Persistence](./state-management.md)
- [SQLite Database Layer](./rust-backend-architecture.md)
- [Error Handling](./error-handling.md)
- [Testing Requirements](./testing-requirements.md)
