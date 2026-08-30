import {
  DEFAULT_MODEL_PARAMS,
  VALIDATION_LIMITS,
  RAG_VALIDATION_LIMITS,
  type ChatMessage,
  type Message,
  type ModelCapabilities,
  type ModelDefaultParams,
  type ModelParamKey,
  type ModelParamProfile,
  type ModelParams,
  type ResolvedModelParams,
} from '@musaed/contracts';

/**
 * Resolve the effective sampling parameters for a model.
 *
 * Resolution order per field:
 *
 * 1. User override for the field, if present in the model's profile.
 * 2. Model's Modelfile default from `/api/show` (`PARAMETER` directives).
 *    Exception: for `numCtx`, the model's `contextLength` from
 *    `model_info` (the true max window) wins over the Modelfile directive —
 *    Ollama ships conservative `num_ctx: 4096` defaults far below what the
 *    model supports. Modelfile `num_ctx` only applies when the window is
 *    unknown.
 * 3. `DEFAULT_MODEL_PARAMS` for the field.
 *
 * Every path that yields `numCtx` is clamped against the model's real
 * context window when known (so the value sent to Ollama never overshoots
 * it) and against `NUM_CTX_RANGE`'s ceiling (Rust range-validates and
 * rejects — rather than clamps — out-of-range requests). The raw stored
 * override is reported back untouched via `rawNumCtxOverride`, with
 * `numCtxClamped` set whenever resolution had to reduce it.
 */
export function resolveModelParams(
  profile: ModelParamProfile | undefined,
  caps: ModelCapabilities | null
): ResolvedModelParams {
  const d = caps?.modelfileDefaults ?? null;
  const window = caps?.contextWindow ?? null;
  const ceiling = VALIDATION_LIMITS.NUM_CTX_RANGE[1];
  const fallback = (key: 'temperature' | 'topP' | 'topK' | 'numPredict'): number =>
    d?.[key] ?? DEFAULT_MODEL_PARAMS[key];
  // Clamp any candidate against the real window, then the absolute ceiling.
  const fitNumCtx = (candidate: number): number =>
    Math.min(window !== null ? Math.min(candidate, window) : candidate, ceiling);

  const baseNumCtx = window ?? d?.numCtx ?? DEFAULT_MODEL_PARAMS.numCtx;
  if (!profile || profile.overrides.length === 0) {
    return {
      params: {
        temperature: fallback('temperature'),
        topP: fallback('topP'),
        topK: fallback('topK'),
        numPredict: fallback('numPredict'),
        numCtx: fitNumCtx(baseNumCtx),
      },
      rawNumCtxOverride: null,
      numCtxClamped: false,
    };
  }

  const overrides = profile.overrides;
  const stored = profile.params;
  const pick = <K extends ModelParamKey>(key: K, fb: number): number =>
    overrides.includes(key) ? stored[key] : fb;
  const raw = overrides.includes('numCtx') ? stored.numCtx : null;
  const params: ModelParams = {
    temperature: pick('temperature', fallback('temperature')),
    topP: pick('topP', fallback('topP')),
    topK: pick('topK', fallback('topK')),
    numPredict: pick('numPredict', fallback('numPredict')),
    numCtx: fitNumCtx(raw ?? baseNumCtx),
  };
  return {
    params,
    rawNumCtxOverride: raw,
    numCtxClamped: raw !== null && params.numCtx !== raw,
  };
}

export type { ModelCapabilities, ModelDefaultParams, ResolvedModelParams };

// --- Token estimation (single home for all estimation constants) ---

/** Latin prose averages ~4 chars per token. */
const LATIN_CHARS_PER_TOKEN = 4;
/** Arabic script is far denser: ~2 chars per token. Using the latin ratio
 *  on Arabic undercounts prompt size by ~2x and overfills contexts. */
const ARABIC_CHARS_PER_TOKEN = 2;
/** Share of Arabic-script characters above which the Arabic ratio applies. */
const ARABIC_SHARE_THRESHOLD = 0.3;
const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/** Estimate the token count of a text snippet. These remain estimates until
 *  Ollama reports authoritative `prompt_eval_count` facts post-turn. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const arabicChars = text.match(ARABIC_CHAR_RE)?.length ?? 0;
  const charsPerToken =
    arabicChars / text.length >= ARABIC_SHARE_THRESHOLD
      ? ARABIC_CHARS_PER_TOKEN
      : LATIN_CHARS_PER_TOKEN;
  return Math.ceil(text.length / charsPerToken);
}

/** A prior message is eligible as chat history when it is a user/assistant
 *  turn with content that isn't an error/stopped placeholder and doesn't
 *  belong to the request currently being built. */
function isEligibleHistoryMessage(message: Message, currentRequestId: string): boolean {
  if (message.requestId === currentRequestId) return false;
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  if (!message.content) return false;
  return !message.error && !message.stopped;
}

/**
 * Total estimated tokens of all eligible history EXCLUDING the current turn.
 *
 * Each message is weighted by its own content only. Assistant messages'
 * `promptEvalCount` is Ollama's cumulative count for that whole turn's
 * prompt (system + all prior history + RAG + user message) — summing those
 * double-counts overlapping wholes and truncates history far too eagerly.
 */
export function estimateHistoryTokens(
  convMessages: readonly Message[],
  currentRequestId: string
): number {
  let total = 0;
  for (let i = convMessages.length - 1; i >= 0; i--) {
    const msg = convMessages[i];
    if (isEligibleHistoryMessage(msg, currentRequestId)) total += estimateTextTokens(msg.content);
  }
  return total;
}

/**
 * Build a token-budgeted slice of prior conversation messages to send as
 * context. Walks backwards from the newest eligible message and stops at
 * the first message that would overflow `inputBudgetTokens`; each message
 * is weighted by its own content estimate (see {@link estimateHistoryTokens}).
 * The returned slice is in chronological order.
 */
export function buildHistorySlice(
  convMessages: readonly Message[],
  currentRequestId: string,
  inputBudgetTokens: number
): ChatMessage[] {
  const budget = Math.max(0, Math.floor(inputBudgetTokens));
  if (budget <= 0 || convMessages.length === 0) return [];

  const history: ChatMessage[] = [];
  let used = 0;
  for (let i = convMessages.length - 1; i >= 0; i--) {
    const msg = convMessages[i];
    if (!isEligibleHistoryMessage(msg, currentRequestId)) continue;
    const tokens = estimateTextTokens(msg.content);
    if (used + tokens > budget) break;
    history.unshift({ role: msg.role, content: msg.content });
    used += tokens;
  }
  return history;
}

// --- RAG char budget ---

/** Chars-per-token ratio used for char-capacity budgets (matches Rust's
 *  `context_assembler` chars/3 accounting — consumed as an opaque estimate). */
const CHARS_PER_TOKEN = 3;

/** Chars always held back so assembly never produces an empty-useless budget. */
const MIN_RAG_RESERVE_CHARS = 200;

/** Maximum character budget for RAG context. */
const RAG_MAX_CHARS = RAG_VALIDATION_LIMITS.MAX_RAG_CONTEXT_CHARS;

/**
 * Derive the character budget for RAG context assembly so it fits within the
 * model's context window alongside the system prompt, conversation history,
 * and current user message. Returns undefined when nothing useful remains,
 * letting the RAG hook fall back to its default.
 */
export function computeRagCharBudget(
  numCtx: number,
  systemPromptChars: number,
  historyTokens: number,
  currentPromptChars: number
): number | undefined {
  const totalCharCapacity = numCtx * CHARS_PER_TOKEN;
  const reserveForPrompt = systemPromptChars + currentPromptChars;
  const reserveForHistory = historyTokens * CHARS_PER_TOKEN;
  const remaining =
    totalCharCapacity - reserveForPrompt - reserveForHistory - MIN_RAG_RESERVE_CHARS;

  if (remaining <= 0) return undefined;
  return Math.min(RAG_MAX_CHARS, remaining);
}

// --- Output-aware token budget ---

export interface TokenBudgetInput {
  /** Effective num_ctx for THIS request (post-resolution). */
  contextWindow: number;
  /** System + history + RAG + current message estimate (callers pass ceil()s). */
  estimatedPromptTokens: number;
  /** Requested num_predict; -1/null/undefined = unlimited generation. */
  requestedOutputTokens?: number | null;
}

export interface TokenBudget {
  contextWindow: number;
  estimatedPromptTokens: number;
  requestedOutputTokens: number | null;
  /** What generation may actually produce this turn. */
  effectiveOutputTokens: number;
  /** Room left for input after reserving output (drives history slice + RAG budget). */
  inputBudgetTokens: number;
  /** estimatedPromptTokens alone exceeds the window. */
  isInputOverLimit: boolean;
}

/**
 * Reserve room for generation inside the context window so input assembly
 * cannot crowd out the response. Unlimited requests (-1/null) claim all
 * remaining space — nothing is guaranteed for additional input beyond what
 * `estimatedPromptTokens` already counts; finite requests soft-clamp to the
 * remaining space.
 */
export function calculateTokenBudget(input: TokenBudgetInput): TokenBudget {
  const contextWindow = Math.max(0, Math.floor(input.contextWindow) || 0);
  const estimatedPromptTokens = Math.max(0, Math.floor(input.estimatedPromptTokens) || 0);
  const remaining = Math.max(0, contextWindow - estimatedPromptTokens);

  const requestedRaw = input.requestedOutputTokens ?? null;
  const unlimited = requestedRaw === null || requestedRaw < 0;
  const requested = unlimited ? null : Math.floor(requestedRaw);

  const effectiveOutputTokens = requested === null ? remaining : Math.min(requested, remaining);

  return {
    contextWindow,
    estimatedPromptTokens,
    requestedOutputTokens: requested,
    effectiveOutputTokens,
    inputBudgetTokens: Math.max(0, remaining - effectiveOutputTokens),
    isInputOverLimit: estimatedPromptTokens > contextWindow,
  };
}
