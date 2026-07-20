import { describe, it, expect } from 'vitest';
import {
  IPC_LATENCY_BUDGETS,
  COMMAND_VERSIONS,
  areAllCommandsBudgeted,
  getIpcLatencyBudget,
  getIpcLatencyBudgetCategory,
} from './index';

describe('Contracts: IPC Latency Budgets', () => {
  it('every command registered in COMMAND_VERSIONS has a positive budget', () => {
    const names = Object.keys(COMMAND_VERSIONS);
    expect(names.length).toBeGreaterThan(0);

    const unbudgeted = names.filter((name) => (IPC_LATENCY_BUDGETS[name] ?? 0) <= 0);
    expect(unbudgeted, `Commands missing budgets: ${unbudgeted.join(', ')}`).toEqual([]);
    expect(areAllCommandsBudgeted()).toBe(true);
  });

  it('getIpcLatencyBudget returns 0 for unknown commands', () => {
    expect(getIpcLatencyBudget('cmd_does_not_exist')).toBe(0);
    expect(getIpcLatencyBudget('cmd_ollama_chat')).toBe(IPC_LATENCY_BUDGETS.cmd_ollama_chat);
  });

  it('classifies every command into a budget category', () => {
    const names = Object.keys(COMMAND_VERSIONS);
    const uncategorized = names.filter((name) => getIpcLatencyBudgetCategory(name) === undefined);
    expect(uncategorized, `Uncategorized commands: ${uncategorized.join(', ')}`).toEqual([]);
  });

  it('fire-and-forget commands have the tightest budgets', () => {
    expect(IPC_LATENCY_BUDGETS.cmd_logs_append).toBeLessThanOrEqual(1000);
    expect(IPC_LATENCY_BUDGETS.cmd_trace_append).toBeLessThanOrEqual(1000);
    expect(IPC_LATENCY_BUDGETS.cmd_opener_open_url).toBeLessThanOrEqual(2000);
  });

  it('heavy RAG ops have looser budgets than status checks', () => {
    expect(IPC_LATENCY_BUDGETS.cmd_rag_search).toBeGreaterThan(
      IPC_LATENCY_BUDGETS.cmd_rag_get_project
    );
    expect(IPC_LATENCY_BUDGETS.cmd_rag_assemble_context).toBeGreaterThanOrEqual(
      IPC_LATENCY_BUDGETS.cmd_rag_search
    );
  });
});
