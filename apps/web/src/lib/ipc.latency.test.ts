import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri core API before importing the bridge so we can control latency
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Opt out of the global ipc mock so we can test the real implementation
vi.unmock('@/lib/ipc');

import { invoke } from '@tauri-apps/api/core';
import {
  checkIsTauri,
  ollamaApi,
  ipcStats,
  IPC_LATENCY_BUDGETS,
  snapshotIpcStats,
  resetIpcStats,
} from '@/lib/ipc';

describe('IPC Latency Budgets', () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    resetIpcStats();
    (invoke as unknown as { mockReset: () => void }).mockReset();
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('exports an IPC_LATENCY_BUDGETS map with all known commands', () => {
    expect(IPC_LATENCY_BUDGETS.cmd_ollama_check_health).toBeTypeOf('number');
    expect(IPC_LATENCY_BUDGETS.cmd_ollama_get_models).toBeTypeOf('number');
    expect(IPC_LATENCY_BUDGETS.cmd_rag_search).toBeTypeOf('number');
    expect(IPC_LATENCY_BUDGETS.cmd_export_markdown).toBeTypeOf('number');
    expect(IPC_LATENCY_BUDGETS.cmd_conversations_list).toBeTypeOf('number');
    expect(IPC_LATENCY_BUDGETS.cmd_ollama_chat).toBeGreaterThan(0);
  });

  it('classifies calls under budget as "ok" and updates callCount', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      data: [{ name: 'test-model', size: 100, digest: '123', details: {} }],
    });

    await ollamaApi.getModels('http://localhost:11434');

    expect(ipcStats.callCount).toBe(1);
    expect(ipcStats.violationCount).toBe(0);
    expect(ipcStats.calls).toHaveLength(1);
    expect(ipcStats.calls[0].status).toBe('ok');
    expect(ipcStats.calls[0].command).toBe('cmd_ollama_get_models');
    expect(ipcStats.calls[0].budgetMs).toBe(IPC_LATENCY_BUDGETS.cmd_ollama_get_models);
  });

  it('counts every successful IPC call toward callCount', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    await ollamaApi.abortPull('llama3:8b');
    await ollamaApi.abortPull('mistral:7b');

    expect(ipcStats.callCount).toBe(2);
    expect(ipcStats.violationCount).toBe(0);
    expect(ipcStats.calls).toHaveLength(2);
    expect(ipcStats.calls.every((c) => c.status === 'ok')).toBe(true);
  });

  it('records latency stats even when the backend returns an error', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: false,
      error: { code: 'OLLAMA_UNAVAILABLE', message: 'down' },
    });

    await ollamaApi.getModels('http://localhost:11434');

    expect(ipcStats.callCount).toBe(1);
    expect(ipcStats.calls).toHaveLength(1);
    expect(ipcStats.violationCount).toBe(0);
  });

  it('does not record latency for calls blocked before the request (invalid URL)', async () => {
    const result = await ollamaApi.getModels('http://evil.example.com');

    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(ipcStats.callCount).toBe(0);
  });

  it('does not record latency when not running inside Tauri', async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const result = await ollamaApi.getModels('http://localhost:11434');

    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(ipcStats.callCount).toBe(0);

    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  it('flags violations when latency exceeds the budget', async () => {
    // Patch performance.now so the second measurement (after invoke resolves)
    // breaches the budget (cmd_ollama_abort_pull = 1000 ms).
    let calls = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      calls += 1;
      return calls <= 1 ? 0 : 1250;
    });

    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    await ollamaApi.abortPull('llama3:8b');

    expect(ipcStats.callCount).toBe(1);
    expect(ipcStats.violationCount).toBe(1);
    expect(ipcStats.calls).toHaveLength(1);
    expect(ipcStats.calls[0].status).toBe('violation');
    expect(ipcStats.calls[0].latencyMs).toBe(1250);
    expect(ipcStats.calls[0].budgetMs).toBe(1000);

    spy.mockRestore();
  });

  it('treats commands missing a budget entry as unlimited (status === "ok")', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });
    await ollamaApi.abortPull('llama3:8b');
    expect(ipcStats.calls).toHaveLength(1);
    expect(ipcStats.calls[0].budgetMs).toBeGreaterThan(0);
  });

  it('snapshot returns a deep copy that does not mutate live counters', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });
    await ollamaApi.abortPull('llama3:8b');

    const snap = snapshotIpcStats();
    expect(snap.callCount).toBe(1);
    expect(snap.calls).toHaveLength(1);

    snap.calls.length = 0;
    expect(ipcStats.calls).toHaveLength(1);
  });

  it('reset clears all counters', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });
    await ollamaApi.abortPull('llama3:8b');
    await ollamaApi.abortPull('mistral:7b');

    resetIpcStats();

    expect(ipcStats.callCount).toBe(0);
    expect(ipcStats.violationCount).toBe(0);
    expect(ipcStats.calls).toHaveLength(0);
  });

  it('detects tauri environment correctly (sanity)', () => {
    expect(checkIsTauri()).toBe(true);
  });
});
