import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Paths accessible without a session. Everything else requires auth.
const PUBLIC_PATHS = new Set<string>(["/", "/login"]);
const PUBLIC_PREFIXES = [
  "/auth/", // OAuth callback and related
  "/api/log", // Client error reports (pre-auth pages log here too)
  "/api/debug/", // Dev-only debug endpoints (route handlers 404 in prod)
];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return response;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return response;

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?redirect=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Exclude Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
