/**
 * Model Store Migrations
 *
 * Defines migrations for the model-store schema evolution.
 * Current schema version: 1 (initial)
 *
 * Future migrations:
 * - v2: Add model categorization fields
 * - v3: Add model performance metrics cache
 */

import type { ModelState } from '@musaed/contracts';
import { ModelStateSchema, DEFAULT_MODEL_STATE } from '@musaed/contracts';

/**
 * Migration v1 (Initial schema)
 * Ensures model state has all required fields.
 */
export const migrateModelToV1 = (data: unknown): ModelState => {
  const persisted = typeof data === 'object' && data !== null ? (data as Partial<ModelState>) : {};

  return { ...DEFAULT_MODEL_STATE, ...persisted };
};

/**
 * Validation function for model state.
 */
export const validateModel = (data: unknown): ModelState => {
  return ModelStateSchema.parse(data);
};

/**
 * Model migration registry.
 */
export const modelMigrations = {
  1: migrateModelToV1,
};

/**
 * Current schema version for the model store.
 */
export const MODEL_STORE_VERSION = 1;
