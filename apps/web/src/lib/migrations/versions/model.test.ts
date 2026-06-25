import { describe, it, expect } from 'vitest';
import { modelMigrations, validateModel, migrateModelToV1, MODEL_STORE_VERSION } from './model';
import { DEFAULT_MODEL_STATE } from '@musaed/contracts';

describe('Model Store Migrations', () => {
  describe('MODEL_STORE_VERSION', () => {
    it('should be version 1', () => {
      expect(MODEL_STORE_VERSION).toBe(1);
    });
  });

  describe('migrateModelToV1', () => {
    it('should merge partial data with defaults', () => {
      const partialData = { selectedModel: 'mistral' };
      const result = migrateModelToV1(partialData);

      expect(result.selectedModel).toBe('mistral');
    });

    it('should return defaults for null input', () => {
      const result = migrateModelToV1(null);

      expect(result).toEqual(DEFAULT_MODEL_STATE);
    });

    it('should return defaults for undefined input', () => {
      const result = migrateModelToV1(undefined);

      expect(result).toEqual(DEFAULT_MODEL_STATE);
    });

    it('should return defaults for non-object input', () => {
      const result = migrateModelToV1(123);

      expect(result).toEqual(DEFAULT_MODEL_STATE);
    });

    it('should preserve all DEFAULT_MODEL_STATE fields', () => {
      const result = migrateModelToV1({});

      expect(result.selectedModel).toBe(DEFAULT_MODEL_STATE.selectedModel);
    });
  });

  describe('validateModel', () => {
    it('should validate correct model state', () => {
      const validState = {
        selectedModel: 'llama3',
      };

      const result = validateModel(validState);

      expect(result).toEqual(validState);
    });

    it('should throw on invalid schema', () => {
      const invalidState = { selectedModel: 123 };

      expect(() => validateModel(invalidState)).toThrow();
    });

    it('should use default values when fields missing', () => {
      const minimalState = {};

      const result = validateModel(minimalState);

      expect(result.selectedModel).toBe(DEFAULT_MODEL_STATE.selectedModel);
    });
  });

  describe('modelMigrations registry', () => {
    it('should have migration for version 1', () => {
      expect(modelMigrations[1]).toBeDefined();
      expect(typeof modelMigrations[1]).toBe('function');
    });

    it('should only have version 1 migration', () => {
      const versions = Object.keys(modelMigrations).map(Number);
      expect(versions).toEqual([1]);
    });
  });
});
