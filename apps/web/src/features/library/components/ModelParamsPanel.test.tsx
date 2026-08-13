import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModelParamsPanel from './ModelParamsPanel';

// Mutable mock state so each test can seed profiles/overrides before render.
let mockSelectedModel = 'llama3.1';
let mockContextWindow: number | null = 8192;
let mockDefaultParams: {
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  numCtx: number | null;
  numPredict: number | null;
} | null = null;
let mockProfiles: Record<string, unknown> = {};

const mockSetParam = vi.fn();
const mockResetParam = vi.fn();

// Identity i18n — returns the key verbatim so assertions sit on keys.
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => n.toString(),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (s: { globalSettings: { language: string } }) => unknown) =>
    selector({ globalSettings: { language: 'en' } }),
}));

vi.mock('@/store/model-store', () => ({
  useModelStore: (selector: (s: { selectedModel: string }) => unknown) =>
    selector({ selectedModel: mockSelectedModel }),
}));

vi.mock('@/store/model-params-store', () => ({
  useModelParamsStore: (
    selector: (s: { setParam: typeof mockSetParam; resetParam: typeof mockResetParam }) => unknown
  ) => selector({ setParam: mockSetParam, resetParam: mockResetParam }),
  useResolvedModelParams: (
    modelName: string,
    contextLength: number | null,
    defaultParams: {
      temperature: number | null;
      topP: number | null;
      topK: number | null;
      numCtx: number | null;
      numPredict: number | null;
    } | null = null
  ) => {
    const profile = mockProfiles[modelName] as
      { overrides: string[]; params: Record<string, number> } | undefined;
    const overrides = profile?.overrides ?? [];
    const params = profile?.params ?? {};
    const dpFallback = (k: 'temperature' | 'topP' | 'topK' | 'numPredict', fallback: number) =>
      defaultParams?.[k] ?? fallback;
    const numCtxModelfile = defaultParams?.numCtx ?? null;
    const resolve = (k: string, fallback: number) => (overrides.includes(k) ? params[k] : fallback);
    const numCtxOverride = overrides.includes('numCtx') ? params.numCtx : null;
    const numCtxClamped =
      numCtxOverride !== null && contextLength !== null && numCtxOverride > contextLength;
    const numCtx =
      numCtxOverride === null
        ? (numCtxModelfile ?? contextLength ?? 4096)
        : contextLength !== null && numCtxOverride > contextLength
          ? contextLength
          : numCtxOverride;
    return {
      temperature: resolve('temperature', dpFallback('temperature', 0.7)),
      topK: resolve('topK', dpFallback('topK', 40)),
      topP: resolve('topP', dpFallback('topP', 0.9)),
      numPredict: resolve('numPredict', dpFallback('numPredict', 2048)),
      numCtx,
      rawNumCtxOverride: numCtxOverride,
      numCtxClamped,
    };
  },
  useIsParamOverridden: (modelName: string, key: string) =>
    !!mockProfiles[modelName] &&
    (mockProfiles[modelName] as { overrides: string[] }).overrides.includes(key),
}));

vi.mock('../hooks/useModelContextWindow', () => ({
  useModelContextWindow: () => ({
    contextWindow: mockContextWindow,
    defaultParams: mockDefaultParams,
    loading: false,
    error: null,
  }),
}));

beforeEach(() => {
  mockSelectedModel = 'llama3.1';
  mockContextWindow = 8192;
  mockDefaultParams = null;
  mockProfiles = {};
  mockSetParam.mockClear();
  mockResetParam.mockClear();
});

describe('ModelParamsPanel — per-model sampling parameters', () => {
  it('renders the Parameters header with the selected model name', () => {
    render(<ModelParamsPanel />);
    expect(screen.getByText('library.modelParameters')).toBeInTheDocument();
    expect(screen.getByText('llama3.1', { exact: false })).toBeInTheDocument();
  });

  it('renders all five sampling controls', () => {
    render(<ModelParamsPanel />);
    expect(screen.getByText('settings.temperature')).toBeInTheDocument();
    expect(screen.getByText('settings.topP')).toBeInTheDocument();
    expect(screen.getByText('settings.topK')).toBeInTheDocument();
    expect(screen.getByText('settings.contextWindow')).toBeInTheDocument();
    expect(screen.getByText('settings.maxTokens')).toBeInTheDocument();
  });

  it('renders the per-model hint caption', () => {
    render(<ModelParamsPanel />);
    expect(screen.getByText('library.paramsPerModelHint')).toBeInTheDocument();
  });

  it('updates temperature via the slider range input', () => {
    render(<ModelParamsPanel />);
    const rangeInputs = screen.getAllByRole('slider');
    // First range input is temperature.
    fireEvent.change(rangeInputs[0], { target: { value: '0.3' } });
    expect(mockSetParam).toHaveBeenCalledWith('llama3.1', 'temperature', 0.3);
  });

  it('invokes resetParam when an overridden field reset button is clicked', () => {
    mockProfiles = {
      'llama3.1': {
        overrides: ['temperature'],
        params: { temperature: 0.3, topK: 40, topP: 0.9, numCtx: 8192, numPredict: 2048 },
      },
    };
    render(<ModelParamsPanel />);
    // Override reset buttons are the only ones with an aria-label ending
    // in "reset to default".
    const resetBtn = screen.getByLabelText('settings.temperature reset to default');
    // The reset button is disabled when the field is not overridden; here it IS.
    expect(resetBtn).not.toBeDisabled();
    fireEvent.click(resetBtn);
    expect(mockResetParam).toHaveBeenCalledWith('llama3.1', 'temperature');
  });

  it('disables the reset button for non-overridden fields', () => {
    render(<ModelParamsPanel />);
    const resetBtn = screen.getByLabelText('settings.topK reset to default');
    expect(resetBtn).toBeDisabled();
  });

  it('clamps the numCtx override against contextLength and shows the clamp hint', () => {
    mockProfiles = {
      'llama3.1': {
        overrides: ['numCtx'],
        params: { temperature: 0.7, topK: 40, topP: 0.9, numCtx: 32768, numPredict: 2048 },
      },
    };
    // contextLength is 8192 (default), override is 32768 → clamp.
    render(<ModelParamsPanel />);
    expect(screen.getByText('library.numCtxAboveModelMax')).toBeInTheDocument();
  });

  it('does not show the clamp hint when override is within model max', () => {
    mockProfiles = {
      'llama3.1': {
        overrides: ['numCtx'],
        params: { temperature: 0.7, topK: 40, topP: 0.9, numCtx: 4096, numPredict: 2048 },
      },
    };
    render(<ModelParamsPanel />);
    expect(screen.queryByText('library.numCtxAboveModelMax')).not.toBeInTheDocument();
  });

  it('surfaces Modelfile defaultParams through the resolved display values', () => {
    // No profile/override — resolved values should come from defaultParams
    // rather than the hardcoded DEFAULT_MODEL_PARAMS.
    mockDefaultParams = {
      temperature: 0.5,
      topP: 0.85,
      topK: 64,
      numCtx: 16384,
      numPredict: 512,
    };
    mockContextWindow = 32768;
    render(<ModelParamsPanel />);
    // The NumberInput display value for numCtx is formatted via the identity
    // formatNumber mock, so the resolved 16384 should appear as "16384".
    const numInput = screen.getByDisplayValue('16384');
    expect(numInput).toBeInTheDocument();
    // numPredict (MaxTokens) display shows the Modelfile default 512.
    expect(screen.getByDisplayValue('512')).toBeInTheDocument();
  });

  it('prefers user override over Modelfile defaultParams for displayed values', () => {
    mockProfiles = {
      'llama3.1': {
        overrides: ['temperature'],
        params: { temperature: 0.3, topK: 40, topP: 0.9, numCtx: 8192, numPredict: 2048 },
      },
    };
    mockDefaultParams = {
      temperature: 0.5,
      topP: 0.85,
      topK: 64,
      numCtx: 16384,
      numPredict: 512,
    };
    render(<ModelParamsPanel />);
    // Override (0.3) wins over defaultParams.temperature (0.5); the override-
    // formatted display uses formatNumber → "0.3".
    expect(screen.getByText('0.3')).toBeInTheDocument();
  });

  it('clamps numCtxMax to NUM_CTX_RANGE ceiling when contextWindow exceeds it', () => {
    mockContextWindow = 4_000_000;
    render(<ModelParamsPanel />);
    // numCtx is the first <input type="number"> (numPredict is the second).
    const numCtxInput = screen.getAllByRole('spinbutton')[0];
    // Math.min(4M, 2_097_152) → the max attribute should be 2097152, not 4M.
    expect(numCtxInput.getAttribute('max')).toBe(String(2_097_152));
  });
});
