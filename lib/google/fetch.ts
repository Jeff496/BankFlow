import { ExternalServiceError } from "@/lib/api/errors";
import { refreshGoogleToken } from "./oauth";
import { log } from "@/lib/logger";

/** Tokens that may be updated mid-request via the refresh flow. */
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * HTTP wrapper for Google API calls with automatic token refresh. On a 401
 * from Google (expired access token), refreshes using the stored refresh
 * token and retries once. The updated access token is written back into
 * the passed-in `tokens` object so subsequent calls in the same request
 * use the fresh token.
 *
 * Non-401 failures surface as ExternalServiceError with the Google error
 * body attached as context.
 */
export async function googleFetch(
  url: string,
  tokens: GoogleTokens,
  init: RequestInit = {},
  label = "google.api",
): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await doFetch(tokens.accessToken);

  if (res.status === 401) {
    const refreshed = await refreshGoogleToken(tokens.refreshToken);
    tokens.accessToken = refreshed.accessToken;
    res = await doFetch(tokens.accessToken);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log().warn({
      event: "sheets.api.error",
      label,
      status: res.status,
      body: body.slice(0, 1000),
      url,
    });
    throw new ExternalServiceError(
      `Google API ${label} failed (${res.status})`,
      { status: res.status, body: body.slice(0, 500) },
    );
  }

  return res;
}

export async function googleJson<T>(
  url: string,
  tokens: GoogleTokens,
  init: RequestInit = {},
  label = "google.api",
): Promise<T> {
  const res = await googleFetch(url, tokens, init, label);
  return (await res.json()) as T;
}
