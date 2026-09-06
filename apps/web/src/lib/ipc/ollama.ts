import { callInternal } from './transport';

/**
 * Ollama Engine API - manages Ollama server interactions.
 * - getModels: fetches list of installed models
 * - deleteModel: removes a model from the server
 * - pullModel: downloads a model (async, void return)
 * - checkHealth: checks if Ollama is running (quiet, no toast)
 * - verifyService: performs a simple ping to verify Ollama responds
 */
export const ollamaApi = {
  /**
   * Fetches the list of installed models from the Ollama server.
   * @param baseUrl - The Ollama server URL (e.g., http://localhost:11434)
   * @returns Array of model info or null if call failed/blocked
   */
  getModels: (baseUrl: string) => callInternal('cmd_ollama_get_models', { baseUrl }),
  /**
   * Deletes a model from the Ollama server.
   * @param baseUrl - The Ollama server URL
   * @param name - Name of the model to delete
   * @returns true if deletion succeeded, false otherwise
   */
  deleteModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_delete_model', { baseUrl, name }),
  /**
   * Starts pulling (downloading) a model. This is an async operation on the backend.
   * @param baseUrl - The Ollama server URL
   * @param name - Name of the model to pull
   */
  pullModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_pull_model', { baseUrl, name }),
  /**
   * Cancels an in-progress model pull. Backend short-circuits to success
   * when no active pull exists for the given model name.
   * @param name - Name of the model whose pull should be aborted
   */
  abortPull: (name: string) => callInternal('cmd_ollama_abort_pull', { name }),
  /**
   * Checks the health of the Ollama server (quiet mode, no toast on failure).
   * @param baseUrl - The Ollama server URL
   * @returns Health data including version and response time, or null if unhealthy/blocked
   */
  checkHealth: (baseUrl: string) =>
    callInternal('cmd_ollama_check_health', { baseUrl }, { quiet: true }),
  /**
   * Verifies that the Ollama service is reachable and responsive.
   * @param baseUrl - The Ollama server URL
   * @returns A status string (typically "ok") or empty on failure
   */
  verifyService: (baseUrl: string) => callInternal('cmd_ollama_verify_service', { baseUrl }),
  /**
   * Validates that a model exists on the Ollama server and returns its
   * metadata, including the `context_length` parsed from `/api/show`.
   * @param baseUrl - The Ollama server URL
   * @param name - The model name to validate
   * @returns Model validation result with contextLength, or null on failure
   */
  validateModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_validate_model', { baseUrl, name }, { quiet: true }),
};
