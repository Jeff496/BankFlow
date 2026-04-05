import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Creates a Supabase server client bound to the current request's cookies.
 * Use this inside Server Components, Route Handlers, and Server Actions.
 *
 * The JWT flows through automatically, so `auth.uid()` resolves inside RLS
 * policies. Do NOT fall back to the service-role admin client to fix RLS
 * denials — look for chicken-and-egg policies or missing SECURITY DEFINER
 * triggers first.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component. Safe to ignore — middleware
          // handles session refresh. See @supabase/ssr docs.
        }
      },
    },
  });
}
