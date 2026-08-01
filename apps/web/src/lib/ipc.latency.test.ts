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
  resetIpcViolations,
  getIpcViolations,
  subscribeIpcViolations,
  type IpcViolationRecord,
} from '@/lib/ipc';
import { IPC_CALLS_HISTORY_MAX } from '@/lib/ipc-latency';

describe('IPC Latency Budgets', () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    resetIpcViolations();
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

  it('caps ipcStats.calls at IPC_CALLS_HISTORY_MAX (FIFO eviction)', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    const over = IPC_CALLS_HISTORY_MAX + 5;
    for (let i = 0; i < over; i += 1) {
      await ollamaApi.abortPull('llama3:8b');
    }

    expect(ipcStats.callCount).toBe(over);
    expect(ipcStats.calls).toHaveLength(IPC_CALLS_HISTORY_MAX);
    // The oldest entries were evicted; the first remaining record is the
    // (over - IPC_CALLS_HISTORY_MAX)-th call, so its command still matches.
    expect(ipcStats.calls[0].command).toBe('cmd_ollama_abort_pull');
  });
});

describe('IPC latency violation trace pipeline', () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    resetIpcViolations();
    (invoke as unknown as { mockReset: () => void }).mockReset();
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('dispatches a structured budget_violation trace entry via cmd_trace_append on violation', async () => {
    // Force every IPC call to look like a 1500 ms call against the
    // 1000 ms budget for cmd_ollama_abort_pull.
    let calls = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      calls += 1;
      return calls <= 1 ? 0 : 1500;
    });

    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    await ollamaApi.abortPull('llama3:8b');

    // traceApi.append triggers an async dynamic import before invoke fires;
    // wait for the call to land on the mock before asserting on its payload.
    await vi.waitFor(() => {
      expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cmd_trace_append')).toBe(
        true
      );
    });

    // find the trace dispatch call
    const traceCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'cmd_trace_append');
    expect(traceCalls).toHaveLength(1);

    const [, payload] = traceCalls[0];
    const input = (payload as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({
      feature: 'ipc',
      action: 'budget_violation',
      source: 'ipc',
      level: 'WARN',
      status: 'timeout',
      latencyMs: 1500,
      message: expect.stringContaining('cmd_ollama_abort_pull'),
    });
    expect(input.context).toMatchObject({
      command: 'cmd_ollama_abort_pull',
      latencyMs: 1500,
      budgetMs: 1000,
      overagePct: 50,
    });
    // traceId must be a UUID-like string
    expect(typeof input.traceId).toBe('string');
    expect((input.traceId as string).length).toBeGreaterThan(10);

    spy.mockRestore();
  });

  it('throttles repeated violations of the same command within the throttle window', async () => {
    vi.useFakeTimers();

    // Every call appears to take 1250 ms against the 1000 ms budget.
    let perfCalls = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      perfCalls += 1;
      // callStart is measurement #1 (returns 0); every subsequent
      // measurement returns a value over the 1000 ms budget.
      return perfCalls === 1 ? 0 : 1250;
    });

    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    const subscriber = vi.fn();
    const unsubscribe = subscribeIpcViolations(subscriber);

    // 5 violations of the same command - all within 100 ms of each other.
    for (let i = 0; i < 5; i++) {
      await ollamaApi.abortPull('llama3:8b');
      vi.advanceTimersByTime(20);
      // Flush microtasks so the dynamic-import chain inside
      // callInternal -> traceApi.append settles before the next iteration.
      await vi.advanceTimersByTimeAsync(0);
    }

    // After all iterations, give the import promise one more flush.
    await vi.advanceTimersByTimeAsync(0);

    const traceCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'cmd_trace_append');

    // Only the first violation should have dispatched a trace entry.
    expect(traceCalls).toHaveLength(1);

    // Also only one record should have been pushed to the history.
    const violations = getIpcViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0].command).toBe('cmd_ollama_abort_pull');

    // The subscriber should have been notified exactly once for the
    // dispatched violation (no notification for the throttled ones).
    expect(subscriber).toHaveBeenCalledTimes(1);

    unsubscribe();
    spy.mockRestore();
  });

  it('notifies subscribers when a violation is dispatched', async () => {
    let perfCalls = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      perfCalls += 1;
      return perfCalls === 1 ? 0 : 1500;
    });

    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    const received: IpcViolationRecord[] = [];
    const unsubscribe = subscribeIpcViolations(() => {
      received.push(...getIpcViolations());
    });

    await ollamaApi.abortPull('llama3:8b');

    expect(received).toHaveLength(1);
    expect(received[0].command).toBe('cmd_ollama_abort_pull');
    expect(received[0].latencyMs).toBe(1500);
    expect(received[0].budgetMs).toBe(1000);

    unsubscribe();
    spy.mockRestore();
  });
});
