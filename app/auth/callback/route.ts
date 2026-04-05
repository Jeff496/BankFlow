import { NextResponse, type NextRequest } from "next/server";
import { withLogging } from "@/lib/api/with-logging";
import { log } from "@/lib/logger";
import { setUserId } from "@/lib/logger/context";
import { createClient } from "@/lib/supabase/server";

async function handler(req: NextRequest): Promise<Response> {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const oauthError = searchParams.get("error");

  if (oauthError) {
    log().warn({
      event: "auth.callback.error",
      oauthError,
      description: searchParams.get("error_description"),
    });
    return NextResponse.redirect(`${origin}/login?error=${oauthError}`);
  }

  if (!code) {
    log().warn({ event: "auth.callback.error", reason: "missing_code" });
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    log().warn({
      event: "auth.callback.error",
      reason: "exchange_failed",
      message: error?.message,
    });
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  setUserId(data.user.id);
  log().info({
    event: "auth.login",
    userId: data.user.id,
    provider: "google",
  });

  // Only allow relative paths to prevent open-redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return NextResponse.redirect(`${origin}${safeNext}`);
}

export const GET = withLogging(handler, "GET /auth/callback");
