import { createClient } from "@/lib/supabase/server";
import { setUserId } from "@/lib/logger/context";
import { AuthError } from "./errors";

/**
 * Resolves the current authenticated user via the request's Supabase cookies.
 * Throws `AuthError` (401) if no user is signed in. Also attaches the user's
 * id to the request log context so every subsequent log line carries it.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new AuthError("sign in first");
  }
  setUserId(data.user.id);
  return { supabase, user: data.user };
}
