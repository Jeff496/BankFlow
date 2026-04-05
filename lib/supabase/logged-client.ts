import { log } from "@/lib/logger";

type SupabaseResult = { data: unknown; error: unknown };

/**
 * Wraps a single Supabase query in timing + structured logging. Throws the
 * underlying PostgrestError on failure so the central error-handler can map
 * it (RLS → RLSDeniedError, unique_violation → ConflictError, etc.).
 *
 * Return type is `NonNullable<R["data"]>` — we throw when data is null, so
 * callers can use the result directly without a null check.
 *
 * Usage:
 *   const budgets = await tracedQuery('budgets.list', () =>
 *     supabase.from('budgets').select('*'),
 *   );
 */
export async function tracedQuery<R extends SupabaseResult>(
  label: string,
  fn: () => PromiseLike<R>,
): Promise<NonNullable<R["data"]>> {
  const start = performance.now();
  const { data, error } = await fn();
  const durationMs = Math.round(performance.now() - start);

  if (error) {
    log().warn({ event: "db.query.error", label, durationMs, error });
    throw error;
  }

  const level: "warn" | "debug" = durationMs > 1000 ? "warn" : "debug";
  log()[level]({
    event: durationMs > 1000 ? "db.query.slow" : "db.query.ok",
    label,
    durationMs,
    rowCount: Array.isArray(data) ? data.length : data == null ? 0 : 1,
  });

  if (data == null) {
    // Caller expected rows but got none. For .single() queries this maps to
    // PGRST116; for list queries returning null, surface explicitly.
    throw new Error(`tracedQuery('${label}') returned null data`);
  }
  return data as NonNullable<R["data"]>;
}
