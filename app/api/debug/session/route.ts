import { withLogging } from "@/lib/api/with-logging";
import { NotFoundError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Dev-only: returns the current Supabase session, including whether a
 * provider refresh token is present (without logging the token value).
 * Returns 404 in production.
 */
async function handler() {
  if (process.env.VERCEL_ENV === "production") {
    throw new NotFoundError("Not found");
  }

  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const { data: userData } = await supabase.auth.getUser();

  const session = sessionData.session;

  return Response.json({
    user: userData.user
      ? {
          id: userData.user.id,
          email: userData.user.email,
          provider: userData.user.app_metadata?.provider,
          raw_user_meta_data: userData.user.user_metadata,
        }
      : null,
    session: session
      ? {
          expires_at: session.expires_at,
          token_type: session.token_type,
          provider_token_present: Boolean(session.provider_token),
          provider_refresh_token_present: Boolean(
            session.provider_refresh_token,
          ),
        }
      : null,
  });
}

export const GET = withLogging(handler, "GET /api/debug/session");
