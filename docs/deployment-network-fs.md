# Deployment: SQLite WAL Mode & Network Filesystems

## WAL mode is required

The application database runs in SQLite **WAL (Write-Ahead Logging)** mode.
This is required for data safety: WAL gives atomic commits, crash
recovery, and safe concurrent read/write access. Deployments where WAL
cannot be activated are **not supported**.

## WAL does not work on network filesystems

WAL needs reliable shared-memory (`mmap`) locking between processes.
Network filesystems — **NFS, SMB/CIFS, and similar remote mounts** — do
not provide correct cross-host byte-range locking and shared-memory
semantics for this to work.

If the database file sits on network storage, SQLite will **silently fall
back to DELETE (rollback journal) mode** instead of WAL.

## Why this matters: corruption risk

DELETE mode on a network filesystem is dangerous under concurrent access:

- File locks over NFS/SMB are unreliable, so two writers can interleave.
- Result: **database corruption** — often silent until much later.

There is no warning dialog when this happens. The failure mode is quiet.

## How the app responds

The RAG store verifies WAL after setup and **hard-fails at startup** if it
did not activate (`src-tauri/src/rag/store/connection.rs`). There is no
silently-degraded mode for that database. The conversation database also
requests WAL (`src-tauri/src/conversation/connection.rs`) but does not
currently verify the result — treat that as at-risk on non-local storage.

## Deployment recommendations

1. **Use local SSD storage for the database. Always.** This is the only
   fully supported configuration.
2. **Never run multiple app instances against the same database file.**
   WAL allows concurrent readers/writer within one host; concurrent access
   across machines on a network mount is what corrupts data. If the file
   must live on shared storage, enforce a single running instance
   operationally (deployment-level lock/serialization) — the app does not
   implement a cross-machine single-user lock.
3. **Monitor logs** for startup failures from the RAG store. The error
   message begins `WAL journal mode is required but the database reports
...` and instructs moving the database to local SSD storage.

## Verifying WAL is active

Via the `sqlite3` CLI against the database file:

```bash
sqlite3 /path/to/app.db "PRAGMA journal_mode;"
```

Expected output: `wal`. Anything else (e.g. `delete`) means WAL is not
active and the deployment does not meet requirements.

Application logs: on the RAG-store path, startup fails loudly with the
`WAL journal mode is required ...` error described above; success is
silent for WAL itself, so the CLI check is the definitive verification.
