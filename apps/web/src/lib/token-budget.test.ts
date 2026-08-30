import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_PARAMS,
  VALIDATION_LIMITS,
  type Message,
  type ModelParamKey,
  type ModelParamProfile,
} from '@musaed/contracts';
import {
  resolveModelParams,
  estimateTextTokens,
  estimateHistoryTokens,
  buildHistorySlice,
  computeRagCharBudget,
  calculateTokenBudget,
  type ModelCapabilities,
} from './token-budget';

const profile = (
  overrides: Partial<ModelParamProfile['params']>,
  keys: ModelParamKey[]
): ModelParamProfile => ({
  modelName: 'test-model',
  params: { ...DEFAULT_MODEL_PARAMS, ...overrides },
  overrides: keys,
});

const caps = (
  contextWindow: number | null,
  modelfileDefaults: Partial<NonNullable<ModelCapabilities['modelfileDefaults']>> | null = null
): ModelCapabilities => ({
  contextWindow,
  modelfileDefaults: modelfileDefaults,
});

describe('resolveModelParams', () => {
  describe('without a profile', () => {
    it('returns pure defaults when no profile and no capabilities exist', () => {
      const r = resolveModelParams(undefined, null);
      expect(r.params).toEqual({ ...DEFAULT_MODEL_PARAMS });
      expect(r.rawNumCtxOverride).toBeNull();
      expect(r.numCtxClamped).toBe(false);
    });

    it('uses the model context window for numCtx when the Modelfile default is absent', () => {
      const r = resolveModelParams(undefined, caps(131072));
      expect(r.params.numCtx).toBe(131072);
    });

    it('prefers Modelfile defaults over hard defaults for every field', () => {
      const r = resolveModelParams(
        undefined,
        caps(null, { temperature: 0.5, topP: 0.85, topK: 64, numCtx: 16384, numPredict: -1 })
      );
      expect(r.params).toEqual({
        temperature: 0.5,
        topP: 0.85,
        topK: 64,
        numCtx: 16384,
        numPredict: -1,
      });
    });

    it('falls back field-by-field when individual Modelfile directives are absent', () => {
      const r = resolveModelParams(
        undefined,
        caps(131072, { temperature: 0.5, topP: null, topK: null, numCtx: null, numPredict: null })
      );
      expect(r.params.temperature).toBe(0.5);
      expect(r.params.topP).toBe(DEFAULT_MODEL_PARAMS.topP);
      expect(r.params.topK).toBe(DEFAULT_MODEL_PARAMS.topK);
      expect(r.params.numPredict).toBe(DEFAULT_MODEL_PARAMS.numPredict);
      expect(r.params.numCtx).toBe(131072);
    });

    it('clamps a Modelfile numCtx that exceeds the real context window (F-9)', () => {
      // Modelfile says 16384 but /api/show reports an 8192-token window.
      const r = resolveModelParams(
        undefined,
        caps(8192, { temperature: null, topP: null, topK: null, numCtx: 16384, numPredict: null })
      );
      expect(r.params.numCtx).toBe(8192);
    });

    it('wins the real context window over a conservative Modelfile num_ctx default', () => {
      // Ollama ships num_ctx: 4096 Modelfile defaults on models whose
      // context_length is far larger — the window must win (R-numCtx-max).
      const r = resolveModelParams(
        undefined,
        caps(131072, { temperature: null, topP: null, topK: null, numCtx: 4096, numPredict: null })
      );
      expect(r.params.numCtx).toBe(131072);
    });

    it('falls back to the Modelfile num_ctx only when the window is unknown', () => {
      const r = resolveModelParams(
        undefined,
        caps(null, { temperature: null, topP: null, topK: null, numCtx: 8192, numPredict: null })
      );
      expect(r.params.numCtx).toBe(8192);
    });

    it('clamps the hard-default numCtx to a smaller context window (F-9)', () => {
      const r = resolveModelParams(undefined, caps(2048));
      expect(r.params.numCtx).toBe(2048);
    });
  });

  describe('with a profile', () => {
    it('lets overrides win per field while non-overridden fields take Modelfile fallbacks', () => {
      const p = profile({ temperature: 0.3 }, ['temperature']);
      const r = resolveModelParams(
        p,
        caps(null, { temperature: 0.5, topP: 0.85, topK: 64, numCtx: 4096, numPredict: -1 })
      );
      expect(r.params.temperature).toBe(0.3); // override wins
      expect(r.params.topP).toBe(0.85); // Modelfile fallback
      expect(r.params.topK).toBe(64);
      expect(r.params.numCtx).toBe(4096);
      expect(r.params.numPredict).toBe(-1);
    });

    it('keeps a numCtx override within the window verbatim and unflagged', () => {
      const r = resolveModelParams(profile({ numCtx: 4096 }, ['numCtx']), caps(131072));
      expect(r.params.numCtx).toBe(4096);
      expect(r.rawNumCtxOverride).toBe(4096);
      expect(r.numCtxClamped).toBe(false);
    });

    it('clamps a numCtx override above the window and reports raw value plus flag', () => {
      const r = resolveModelParams(profile({ numCtx: 32768 }, ['numCtx']), caps(8192));
      expect(r.params.numCtx).toBe(8192);
      expect(r.rawNumCtxOverride).toBe(32768);
      expect(r.numCtxClamped).toBe(true);
    });

    it('passes a stored override through verbatim when the window is unknown', () => {
      const r = resolveModelParams(profile({ numCtx: 32768 }, ['numCtx']), caps(null));
      expect(r.params.numCtx).toBe(32768);
      expect(r.rawNumCtxOverride).toBe(32768);
      expect(r.numCtxClamped).toBe(false);
    });

    it('caps any path at the NUM_CTX_RANGE ceiling so Ollama never rejects the request', () => {
      const NUM_CTX_MAX = VALIDATION_LIMITS.NUM_CTX_RANGE[1];
      const viaOverride = resolveModelParams(
        profile({ numCtx: 4_000_000 }, ['numCtx']),
        caps(null)
      );
      expect(viaOverride.params.numCtx).toBe(NUM_CTX_MAX);
      expect(viaOverride.numCtxClamped).toBe(true);

      const viaModelfile = resolveModelParams(
        undefined,
        caps(null, {
          temperature: null,
          topP: null,
          topK: null,
          numCtx: 4_000_000,
          numPredict: null,
        })
      );
      expect(viaModelfile.params.numCtx).toBe(NUM_CTX_MAX);
    });

    it('passes a -1 numPredict override through untouched', () => {
      const r = resolveModelParams(profile({ numPredict: -1 }, ['numPredict']), caps(8192));
      expect(r.params.numPredict).toBe(-1);
    });

    it('treats a profile with empty overrides like no profile', () => {
      const p = profile({ temperature: 999 }, []);
      const r = resolveModelParams(p, caps(null));
      expect(r.params.temperature).toBe(DEFAULT_MODEL_PARAMS.temperature);
      expect(r.rawNumCtxOverride).toBeNull();
      expect(r.numCtxClamped).toBe(false);
    });
  });
});

const msg = (overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({
  id: overrides.id ?? Math.random().toString(36).slice(2),
  timestamp: 0,
  ...overrides,
});

describe('estimateTextTokens', () => {
  it('estimates latin text at ~4 chars per token', () => {
    expect(estimateTextTokens('hello world')).toBe(Math.ceil(11 / 4));
    expect(estimateTextTokens('12345678')).toBe(2);
    expect(estimateTextTokens('a')).toBe(1);
  });

  it('estimates Arabic text at ~2 chars per token', () => {
    // Arabic script is denser per token; latin /4 would undercount ~2x.
    expect(estimateTextTokens('مرحبا')).toBe(Math.ceil(5 / 2));
  });

  it('uses the Arabic ratio when a meaningful share of the text is Arabic', () => {
    // 10 of 17 chars are Arabic-script (~59%) → Arabic ratio applies.
    const mixed = 'مرحبا مرحبا hello';
    expect(estimateTextTokens(mixed)).toBe(Math.ceil(mixed.length / 2));
  });

  it('keeps the latin ratio when Arabic characters are negligible', () => {
    const mostlyLatin = 'use the x config carefully please ok? م';
    expect(estimateTextTokens(mostlyLatin)).toBe(Math.ceil(mostlyLatin.length / 4));
  });

  it('returns 0 for empty input', () => {
    expect(estimateTextTokens('')).toBe(0);
  });
});

describe('estimateHistoryTokens', () => {
  it('sums per-message content estimates, ignoring cumulative promptEvalCount (F-2)', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: '12345678' }), // 2 tokens
      msg({
        role: 'assistant',
        content: 'abcd',
        promptEvalCount: 5000, // cumulative whole-turn count — must NOT be used
      }),
    ];
    expect(estimateHistoryTokens(messages, 'req-current')).toBe(3);
  });

  it('excludes current-turn, non-chat, empty, error and stopped messages', () => {
    const messages: Message[] = [
      msg({ role: 'system', content: 'system text', requestId: 'old' }),
      msg({ role: 'user', content: '', requestId: 'old' }),
      msg({
        role: 'user',
        content: 'errored',
        requestId: 'old',
        error: { code: 'stream-error', message: 'failed' },
      }),
      msg({ role: 'assistant', content: 'stopped', requestId: 'old', stopped: true }),
      msg({ role: 'user', content: 'current turn', requestId: 'req-current' }),
      msg({ role: 'user', content: 'kept!', requestId: 'old' }), // ceil(5/4)=2
    ];
    expect(estimateHistoryTokens(messages, 'req-current')).toBe(2);
  });
});

describe('buildHistorySlice', () => {
  it('returns eligible history in chronological order, excluding the current turn', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: 'q1', requestId: 'r1' }),
      msg({ role: 'assistant', content: 'a1', requestId: 'r1' }),
      msg({ role: 'user', content: 'current', requestId: 'req-current' }),
    ];
    expect(buildHistorySlice(messages, 'req-current', 100)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
  });

  it('drops oldest messages first when the budget runs out', () => {
    const messages: Message[] = [
      msg({ role: 'user', content: '12345678901234567890123456789012', requestId: 'r1' }), // 8 tokens
      msg({ role: 'user', content: '12345678', requestId: 'r2' }), // 2 tokens
    ];
    const slice = buildHistorySlice(messages, 'req-current', 5);
    expect(slice).toEqual([{ role: 'user', content: '12345678' }]);
  });

  it('weights each message by its own content, not cumulative counts (F-2)', () => {
    // An assistant whose cumulative promptEvalCount (500) dwarfs its own
    // content must still fit in a budget sized for its content.
    const bigTurnUser = msg({ role: 'user', content: 'large question', requestId: 'rb' });
    const bigTurnAssistant = msg({
      role: 'assistant',
      content: 'large answer',
      requestId: 'rb',
      promptEvalCount: 500,
    });
    const slice = buildHistorySlice(
      [bigTurnUser, bigTurnAssistant],
      'req-current',
      estimateTextTokens('large question') + estimateTextTokens('large answer')
    );
    expect(slice).toEqual([
      { role: 'user', content: 'large question' },
      { role: 'assistant', content: 'large answer' },
    ]);
  });

  it('returns an empty slice for zero or negative budgets', () => {
    const messages: Message[] = [msg({ role: 'user', content: 'hi', requestId: 'r1' })];
    expect(buildHistorySlice(messages, 'req-current', 0)).toEqual([]);
    expect(buildHistorySlice(messages, 'req-current', -5)).toEqual([]);
  });
});

describe('computeRagCharBudget', () => {
  it('derives char capacity from numCtx at chars-per-token 3 minus reserves', () => {
    // 4096*3 - systemPrompt(0) - history(0) - prompt(5) - floor(200) = 12083.
    expect(computeRagCharBudget(4096, 0, 0, 5)).toBe(12083);
  });

  it('accounts for history tokens converted at the same chars-per-token rate', () => {
    // 4096*3 - prompt(10) - history(10 tokens * 3) - 200 = 12058.
    expect(computeRagCharBudget(4096, 0, 10, 10)).toBe(12288 - 10 - 30 - 200);
  });

  it('caps the budget at MAX_RAG_CONTEXT_CHARS', () => {
    expect(computeRagCharBudget(100000, 0, 0, 5)).toBe(20000);
  });

  it('returns undefined when nothing useful remains', () => {
    expect(computeRagCharBudget(50, 0, 0, 48)).toBeUndefined();
  });
});

describe('calculateTokenBudget', () => {
  it('reserves requested output from the window and leaves the rest for input', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 1000,
      requestedOutputTokens: 2048,
    });
    expect(b).toEqual({
      contextWindow: 4096,
      estimatedPromptTokens: 1000,
      requestedOutputTokens: 2048,
      effectiveOutputTokens: 2048,
      inputBudgetTokens: 1048,
      isInputOverLimit: false,
    });
  });

  it('treats null as unlimited: effective takes all remaining, nothing left for extra input', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 1000,
      requestedOutputTokens: null,
    });
    expect(b.requestedOutputTokens).toBeNull();
    expect(b.effectiveOutputTokens).toBe(3096);
    expect(b.inputBudgetTokens).toBe(0);
    expect(b.isInputOverLimit).toBe(false);
  });

  it('treats -1 (Ollama sentinel) as unlimited', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 1000,
      requestedOutputTokens: -1,
    });
    expect(b.requestedOutputTokens).toBeNull();
    expect(b.effectiveOutputTokens).toBe(3096);
    expect(b.inputBudgetTokens).toBe(0);
  });

  it('treats undefined like unlimited', () => {
    const b = calculateTokenBudget({ contextWindow: 1024, estimatedPromptTokens: 24 });
    expect(b.requestedOutputTokens).toBeNull();
    expect(b.effectiveOutputTokens).toBe(1000);
    expect(b.inputBudgetTokens).toBe(0);
  });

  it('soft-clamps a request above the remaining space', () => {
    // remaining = 1096 < requested 2048 → effective clamps, input budget hits floor.
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 3000,
      requestedOutputTokens: 2048,
    });
    expect(b.effectiveOutputTokens).toBe(1096);
    expect(b.inputBudgetTokens).toBe(0);
  });

  it('accepts a request exactly at the remaining space', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 2048,
      requestedOutputTokens: 2048,
    });
    expect(b.effectiveOutputTokens).toBe(2048);
    expect(b.inputBudgetTokens).toBe(0);
  });

  it('allows requested 0 (classify/extract-style calls) and yields everything to input', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 1000,
      requestedOutputTokens: 0,
    });
    expect(b.effectiveOutputTokens).toBe(0);
    expect(b.inputBudgetTokens).toBe(3096);
    expect(b.isInputOverLimit).toBe(false);
  });

  it('flags over-limit input and floors every derived value at zero', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: 5000,
      requestedOutputTokens: 512,
    });
    expect(b.isInputOverLimit).toBe(true);
    expect(b.effectiveOutputTokens).toBe(0);
    expect(b.inputBudgetTokens).toBe(0);
  });

  it('handles a zero window without dividing into nonsense', () => {
    const empty = calculateTokenBudget({ contextWindow: 0, estimatedPromptTokens: 0 });
    expect(empty.isInputOverLimit).toBe(false);
    expect(empty.effectiveOutputTokens).toBe(0);
    expect(empty.inputBudgetTokens).toBe(0);

    const withPrompt = calculateTokenBudget({ contextWindow: 0, estimatedPromptTokens: 10 });
    expect(withPrompt.isInputOverLimit).toBe(true);
  });

  it('defends against negative inputs by treating them as zero', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096,
      estimatedPromptTokens: -50,
      requestedOutputTokens: 256,
    });
    expect(b.estimatedPromptTokens).toBe(0);
    expect(b.inputBudgetTokens).toBe(3840);
  });

  it('defends against NaN inputs by treating them as zero', () => {
    const b = calculateTokenBudget({
      contextWindow: NaN,
      estimatedPromptTokens: NaN,
      requestedOutputTokens: 128,
    });
    // All-zeros: nothing is reserved and nothing exceeds anything.
    expect(b.contextWindow).toBe(0);
    expect(b.estimatedPromptTokens).toBe(0);
    expect(b.effectiveOutputTokens).toBe(0);
    expect(b.inputBudgetTokens).toBe(0);
    expect(b.isInputOverLimit).toBe(false);
  });

  it('floors fractional inputs to whole tokens', () => {
    const b = calculateTokenBudget({
      contextWindow: 4096.7,
      estimatedPromptTokens: 99.9,
      requestedOutputTokens: 100.5,
    });
    expect(b.contextWindow).toBe(4096);
    expect(b.estimatedPromptTokens).toBe(99);
    expect(b.requestedOutputTokens).toBe(100);
    expect(b.effectiveOutputTokens).toBe(100);
    expect(b.inputBudgetTokens).toBe(3897);
  });

  it('survives huge windows without precision loss for realistic requests', () => {
    const b = calculateTokenBudget({
      contextWindow: 2147483647,
      estimatedPromptTokens: 8192,
      requestedOutputTokens: 32768,
    });
    expect(b.effectiveOutputTokens).toBe(32768);
    expect(b.inputBudgetTokens).toBe(2147483647 - 8192 - 32768);
  });

  it('upholds the invariants across an input sweep', () => {
    const windows = [1, 512, 4096, 131072];
    const prompts = [0, 1, 511, 4096, 5000];
    const requests = [-1, 0, 64, 2048, null];
    for (const contextWindow of windows) {
      for (const estimatedPromptTokens of prompts) {
        for (const requestedOutputTokens of requests) {
          const b = calculateTokenBudget({
            contextWindow,
            estimatedPromptTokens,
            requestedOutputTokens,
          });
          if (b.requestedOutputTokens !== null) {
            expect(b.effectiveOutputTokens).toBeLessThanOrEqual(b.requestedOutputTokens);
          }
          // estimated + effective fits the window whenever input isn't over
          // limit; past the limit everything derived floors at zero.
          if (!b.isInputOverLimit) {
            expect(b.estimatedPromptTokens + b.effectiveOutputTokens).toBeLessThanOrEqual(
              b.contextWindow
            );
          } else {
            expect(b.effectiveOutputTokens).toBe(0);
            expect(b.inputBudgetTokens).toBe(0);
          }
          expect(b.inputBudgetTokens).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
