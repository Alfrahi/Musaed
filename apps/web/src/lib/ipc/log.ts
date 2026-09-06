import { callInternal } from './transport';

/**
 * Logging & Diagnostics API - writes to the application log stream.
 */
export const logApi = {
  /**
   * Appends a log entry to the persistent log stream.
   * @param entry - Log message string (will be validated/truncated per limits)
   */
  append: (entry: string) => callInternal('cmd_logs_append', { entry }),
  /**
   * Requests a confirmation token, then clears all log entries.
   * The two-step token pattern ensures the clear operation was explicitly
   * authorized by the backend, preventing unauthorized log destruction.
   */
  clear: async () => {
    const token = await callInternal('cmd_logs_request_clear_token', {});
    if (!token) return null;
    return callInternal('cmd_logs_clear', { token });
  },
};
