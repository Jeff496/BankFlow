/**
 * Pino redaction paths. Add any new secret-bearing field here AND add a test
 * case. Wildcards apply one level deep; for deeper nesting, add an explicit
 * path.
 */
export const redactPaths = [
  // Headers
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",

  // Auth tokens (top-level)
  "token",
  "refresh_token",
  "access_token",
  "provider_token",
  "provider_refresh_token",
  "id_token",
  "api_key",
  "apiKey",
  "password",

  // Nested one level deep
  "*.token",
  "*.refresh_token",
  "*.access_token",
  "*.provider_token",
  "*.provider_refresh_token",
  "*.id_token",
  "*.api_key",
  "*.apiKey",
  "*.password",

  // Common bodies
  "req.body.password",
  "body.password",
];
