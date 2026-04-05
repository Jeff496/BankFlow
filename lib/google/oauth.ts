import { ExternalServiceError, AuthError } from "@/lib/api/errors";
import { log } from "@/lib/logger";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export class GoogleReauthRequiredError extends AuthError {
  override code = "GOOGLE_REAUTH_REQUIRED";
  constructor(message = "Google refresh token invalid, re-sign in required") {
    super(message);
  }
}

/**
 * Exchange a Google provider refresh token for a fresh access token. Used
 * when a Sheets/Drive API call returns 401 — Google's access tokens expire
 * after 1 hour, and Supabase Auth does NOT auto-refresh provider_token
 * (only its own session token). Caller is responsible for retrying the
 * original request with the new token.
 *
 * Throws GoogleReauthRequiredError if the refresh token is revoked or
 * invalid (user revoked access at myaccount.google.com/permissions, the
 * OAuth app was deleted, etc.) — the UI should prompt for re-signin.
 */
export async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ExternalServiceError(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET env vars are not set",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log().warn({
      event: "sheets.token.refresh_failed",
      status: res.status,
      body: text.slice(0, 500),
    });
    // Google returns 400/401 with error:"invalid_grant" when the refresh
    // token is no longer valid. Either way, the user needs to re-auth.
    if (res.status === 400 || res.status === 401) {
      throw new GoogleReauthRequiredError();
    }
    throw new ExternalServiceError(
      `Google token refresh failed (${res.status})`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  log().info({
    event: "sheets.token.refresh",
    expiresInSec: data.expires_in,
  });

  return { accessToken: data.access_token, expiresInSec: data.expires_in };
}
