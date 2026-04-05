import { log } from "@/lib/logger";

type SupabaseResult<T> = { data: T | null; error: unknown };

/**
 * Wraps a single Supabase query in timing + structured logging. Throws the
 * underlying PostgrestError on failure so the central error-handler can map
 * it (RLS → RLSDeniedError, unique_violation → ConflictError, etc.).
 *
 * Usage:
 *   const budgets = await tracedQuery('budgets.list', () =>
 *     supabase.from('budgets').select('*'),
 *   );
 */
export async function tracedQuery<T>(
  label: string,
  fn: () => PromiseLike<SupabaseResult<T>>,
): Promise<T> {
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
  return data;
}
