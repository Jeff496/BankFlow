/**
 * Centralized access to Supabase env vars.
 *
 * IMPORTANT: Next.js only inlines NEXT_PUBLIC_* env vars into the client
 * bundle when accessed via STATIC property access (`process.env.NEXT_PUBLIC_X`).
 * Dynamic access (`process.env[name]`) is NOT replaced, so the value would
 * be `undefined` in the browser. Keep these as literal property reads.
 */

export function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  return value;
}

export function supabasePublishableKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return value;
}
