import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ModelSelector from './ModelSelector';

// Mutable mock model-store state. Each test seeds these before rendering and
// resets them in `beforeEach`. The selectors return live bindings, so re-render
// picks up new values without re-mocking the module.
let mockSelectedModel = '';
let mockModels: { name: string }[] = [];
const mockSetSelectedModel = vi.fn();
const mockFetchModels = vi.fn();
const mockIsStreaming = { value: false };
const mockIsFetching = { value: false };

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string) => key,
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

vi.mock('@/store/model-store', () => ({
  useModelStore: (
    selector: (s: {
      selectedModel: string;
      models: { name: string }[];
      setSelectedModel: (name: string) => void;
    }) => unknown
  ) =>
    selector({
      selectedModel: mockSelectedModel,
      models: mockModels,
      setSelectedModel: mockSetSelectedModel,
    }),
}));

vi.mock('@/store/ui-store', () => ({
  useUIStore: (selector: (s: { isStreaming: boolean }) => unknown) =>
    selector({ isStreaming: mockIsStreaming.value }),
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (s: { globalSettings: { language: string } }) => unknown) =>
    selector({ globalSettings: { language: 'en' } }),
}));

vi.mock('@/features/library/hooks/useModelActions', () => ({
  useModelActions: () => ({ fetchModels: mockFetchModels, isFetching: mockIsFetching.value }),
}));

// Stub the per-model params panel so the new collapsible "Parameters" section
// does not pull in `useModelContextWindow` / `useModelParamsStore` (which would
// require their own mocks). The panel has its own test file.
vi.mock('./ModelParamsPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="model-params-panel">ModelParamsPanel</div>,
}));

// `act` is needed when firing keyboard events that setState synchronously.
const wrappedKeyDown = (el: HTMLElement, key: string, opts: Record<string, unknown> = {}) => {
  act(() => {
    fireEvent.keyDown(el, { key, ...opts });
  });
};

describe('ModelSelector — ARIA combobox pattern', () => {
  beforeEach(() => {
    mockSelectedModel = '';
    mockModels = [{ name: 'llama3.1' }, { name: 'qwen2.5' }, { name: 'mistral' }];
    mockSetSelectedModel.mockClear();
    mockFetchModels.mockClear();
    mockIsStreaming.value = false;
    mockIsFetching.value = false;
  });

  describe('Trigger semantics', () => {
    it('renders a button with role=combobox, aria-haspopup=listbox, aria-expanded=false', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggles aria-expanded when opened via click', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      // The listbox becomes available in the same DOM.
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('default-renders the selected model name in the trigger', () => {
      mockSelectedModel = 'qwen2.5';
      render(<ModelSelector />);
      expect(screen.getByRole('combobox')).toHaveTextContent('qwen2.5');
    });

    it('renders the placeholder when no model is selected', () => {
      render(<ModelSelector />);
      // Identity i18n returns the key verbatim.
      expect(screen.getByRole('combobox')).toHaveTextContent('library.noModelsFound');
    });
  });

  describe('Listbox + option semantics', () => {
    it('drops the trigger→listbox aria-controls linkage and aria-activedescendant', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      const listboxId = trigger.getAttribute('aria-controls');
      expect(listboxId).toBeTruthy();
      const listbox = document.getElementById(listboxId!);
      expect(listbox).not.toBeNull();
      expect(listbox).toHaveAttribute('role', 'listbox');
      // aria-labelledby on the listbox points back at the trigger id.
      expect(listbox?.getAttribute('aria-labelledby')).toBe(trigger.getAttribute('id'));
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('marks the selected option with aria-selected=true', () => {
      mockSelectedModel = 'mistral';
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      const options = screen.getAllByRole('option');
      const selected = options.find((o) => o.getAttribute('aria-selected') === 'true');
      expect(selected).toBeDefined();
      expect(selected).toHaveTextContent('mistral');
    });

    it('aria-activedescendant on the trigger tracks the active option after open', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      // After open, activeIndex defaults to 0 (no selected model present).
      const optionId = trigger.getAttribute('aria-activedescendant');
      expect(optionId).toBeTruthy();
      const activeEl = document.getElementById(optionId!);
      expect(activeEl).toHaveTextContent('llama3.1');
    });
  });

  describe('Keyboard navigation', () => {
    it('ArrowDown opens the closed listbox', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      wrappedKeyDown(trigger, 'ArrowDown');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('ArrowDown advances the active option and updates aria-activedescendant', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      // Open first.
      fireEvent.click(trigger);
      const firstActive = trigger.getAttribute('aria-activedescendant');
      wrappedKeyDown(trigger, 'ArrowDown');
      const nextActive = trigger.getAttribute('aria-activedescendant');
      expect(nextActive).not.toBe(firstActive);
      const activeEl = document.getElementById(nextActive!);
      expect(activeEl).toHaveTextContent('qwen2.5');
    });

    it('ArrowDown wraps from the last option back to the first', () => {
      // Seed selected model so the open default active index is the last item.
      mockSelectedModel = 'mistral';
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      // mistral is the 3rd (last) option, so ArrowDown wraps to llama3.1.
      wrappedKeyDown(trigger, 'ArrowDown');
      const activeEl = document.getElementById(trigger.getAttribute('aria-activedescendant')!);
      expect(activeEl).toHaveTextContent('llama3.1');
    });

    it('ArrowUp moves the active option up', () => {
      mockSelectedModel = 'mistral';
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      const before = trigger.getAttribute('aria-activedescendant');
      wrappedKeyDown(trigger, 'ArrowUp');
      const after = trigger.getAttribute('aria-activedescendant');
      expect(before).not.toBe(after);
      // mistral (idx 2) → qwen2.5 (idx 1)
      expect(document.getElementById(after!)).toHaveTextContent('qwen2.5');
    });

    it('Home jumps active to first option; End to last', () => {
      mockSelectedModel = 'mistral';
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      wrappedKeyDown(trigger, 'Home');
      expect(
        document.getElementById(trigger.getAttribute('aria-activedescendant')!)
      ).toHaveTextContent('llama3.1');
      wrappedKeyDown(trigger, 'End');
      expect(
        document.getElementById(trigger.getAttribute('aria-activedescendant')!)
      ).toHaveTextContent('mistral');
    });

    it('Enter selects the active option, closes the listbox, and writes to the store', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      wrappedKeyDown(trigger, 'ArrowDown');
      wrappedKeyDown(trigger, 'Enter');
      expect(mockSetSelectedModel).toHaveBeenCalledTimes(1);
      expect(mockSetSelectedModel).toHaveBeenCalledWith('qwen2.5');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('Escape closes an open listbox and returns focus to the trigger', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      wrappedKeyDown(trigger, 'Escape');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(trigger);
    });

    it('Tab closes the listbox without selecting', () => {
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      wrappedKeyDown(trigger, 'Tab');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(mockSetSelectedModel).not.toHaveBeenCalled();
    });

    it('Type-ahead: typing a letter jumps active to the first matching option', () => {
      mockModels = [{ name: 'alpha' }, { name: 'beta' }, { name: 'bravo' }];
      render(<ModelSelector />);
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      // Start at 'alpha' (active by open default). Type 'b' → jump to 'beta'.
      wrappedKeyDown(trigger, 'b');
      const active = document.getElementById(trigger.getAttribute('aria-activedescendant')!);
      expect(active).toHaveTextContent('beta');
    });
  });

  describe('Outside-click close', () => {
    it('clicking outside the dropdown closes the listbox', async () => {
      render(
        <div>
          <ModelSelector />
          <button data-testid="elsewhere">elsewhere</button>
        </div>
      );
      fireEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      // The outside element lives in the same document; the dropdown uses a
      // document-level mousedown listener.
      await act(async () => {
        fireEvent.mouseDown(screen.getByTestId('elsewhere'));
      });
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Refresh button (preserved behavior)', () => {
    it('calls fetchModels(true) when clicked', () => {
      render(<ModelSelector />);
      const refresh = screen.getByTitle('library.refreshModels');
      fireEvent.click(refresh);
      expect(mockFetchModels).toHaveBeenCalledWith(true);
    });
  });

  describe('Loading state', () => {
    it('shows loading indicator instead of empty state when isFetching and no models', () => {
      mockModels = [];
      mockIsFetching.value = true;
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      // The loading indicator uses role=status + aria-live=polite.
      const listbox = screen.getByRole('listbox');
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent('library.loadingModels');
      // The empty-state "no models found" should NOT appear inside the listbox.
      expect(listbox).not.toHaveTextContent('library.noModelsFound');
    });

    it('shows empty state (not loading) when fetch completed with zero models', () => {
      mockModels = [];
      mockIsFetching.value = false;
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      // No loading indicator.
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      // Empty state is shown inside the dropdown listbox (not the trigger).
      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveTextContent('library.noModelsFound');
    });

    it('shows model list (not loading indicator) when models are available during fetch', () => {
      mockModels = [{ name: 'llama3.1' }];
      mockIsFetching.value = true;
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      // Models are already present — list renders normally even during a refetch.
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('Per-model Parameters section (new collapsible)', () => {
    it('is hidden when no model is selected', () => {
      mockSelectedModel = '';
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      // The collapsible only renders when a model is selected.
      expect(screen.queryByTestId('model-params-panel')).not.toBeInTheDocument();
    });

    it('shows the Parameters header (collapsed) when a model is selected', () => {
      mockSelectedModel = 'llama3.1';
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      // The header button uses the library.modelParameters i18n key (identity t).
      const header = screen.getByText('library.modelParameters');
      expect(header).toBeInTheDocument();
      // Panel is collapsed by default.
      expect(screen.queryByTestId('model-params-panel')).not.toBeInTheDocument();
    });

    it('expands and renders the panel when the Parameters header is clicked', () => {
      mockSelectedModel = 'llama3.1';
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      const header = screen.getByText('library.modelParameters');
      fireEvent.click(header);
      // Wait for the uncollapsed panel.
      expect(screen.getByTestId('model-params-panel')).toBeInTheDocument();
      // aria-expanded on the header button reflects the open state.
      expect(header.closest('button')).toHaveAttribute('aria-expanded', 'true');
    });

    it('collapses back when the Parameters header is clicked again', () => {
      mockSelectedModel = 'llama3.1';
      render(<ModelSelector />);
      fireEvent.click(screen.getByRole('combobox'));
      const header = screen.getByText('library.modelParameters');
      fireEvent.click(header);
      expect(screen.getByTestId('model-params-panel')).toBeInTheDocument();
      fireEvent.click(header);
      expect(screen.queryByTestId('model-params-panel')).not.toBeInTheDocument();
      expect(header.closest('button')).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
