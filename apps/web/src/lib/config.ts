/**
 * Typed configuration layer for application-wide environment variables.
 * Use this instead of direct process.env calls to comply with security policies.
 */
export const config = {
  isProd: process.env.NODE_ENV === 'production',
  isDev: process.env.NODE_ENV === 'development',
  isTest: process.env.NODE_ENV === 'test',
  env: process.env.NODE_ENV || 'development',
} as const;
