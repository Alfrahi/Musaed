import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from './model-store';

describe('Model Store', () => {
  beforeEach(() => {
    useModelStore.setState({
      models: [],
      selectedModel: '',
    });
  });

  it('sets models correctly', () => {
    const mockModels = [
      { name: 'llama3', size: 100, digest: '1', details: { format: 'gguf', family: 'llama', parameter_size: '8b', quantization_level: 'q4_0' } }
    ];
    useModelStore.getState().setModels(mockModels as any);
    expect(useModelStore.getState().models).toEqual(mockModels);
  });

  it('updates selected model', () => {
    useModelStore.getState().setSelectedModel('llama3');
    expect(useModelStore.getState().selectedModel).toBe('llama3');
  });
});