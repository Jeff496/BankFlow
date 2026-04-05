import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Refreshes the Supabase session on every request. Called from the root
 * middleware. Returns a NextResponse that the middleware MUST return (or
 * copy cookies from) so the refreshed session cookies reach the browser.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: getUser() revalidates the JWT. Do NOT replace with getSession()
  // which trusts the cookie blindly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
