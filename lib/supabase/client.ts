import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/** Browser client. Safe to call from Client Components. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
