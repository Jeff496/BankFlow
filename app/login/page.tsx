"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reportClientError } from "@/lib/client-logger";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const redirect = new URLSearchParams(window.location.search).get(
        "redirect",
      );
      const nextParam = redirect ? `?next=${encodeURIComponent(redirect)}` : "";

      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback${nextParam}`,
          scopes:
            "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError("Couldn't start sign-in. Please try again.");
      setLoading(false);
      reportClientError(err, { scope: "login" });
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Welcome to BankFlow</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Sign in with Google to continue
          </p>
        </div>

        <button
          type="button"
          onClick={handleSignIn}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GoogleIcon />
          {loading ? "Redirecting…" : "Sign in with Google"}
        </button>

        {error && (
          <p className="text-center text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
