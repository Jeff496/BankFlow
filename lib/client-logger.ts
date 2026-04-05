/** Client-side error reporter. Wire into error boundaries + window.onerror. */
export async function reportClientError(
  err: unknown,
  context?: Record<string, unknown>,
) {
  try {
    await fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        level: "error",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        url:
          typeof window !== "undefined" ? window.location.href : undefined,
        context,
      }),
    });
  } catch {
    // Swallow — we don't want logging errors to break the app.
  }
}
