import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const MAX_HASHES = 5000;

const bodySchema = z.object({
  budget_id: z.uuid(),
  hashes: z
    .array(z.string().regex(/^[0-9a-f]{64}$/, "must be 64-char hex (sha256)"))
    .min(1)
    .max(MAX_HASHES),
});

/**
 * Returns the subset of `hashes` that already exist as transactions in the
 * given budget. Used by the upload UI preview to flag duplicates before the
 * user confirms the import.
 *
 * POST not GET because 5000 * 64-char hashes is too long for a query string.
 * RLS on transactions_select filters to budgets the user is a member of, so
 * asking about a budget you can't see just returns an empty array.
 */
async function handler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { budget_id, hashes } = bodySchema.parse(body);

  // Batch .in() to avoid exceeding PostgREST URL length limits
  // (~26KB for 400 hashes would blow the ~8KB query string cap).
  const BATCH = 100;
  const allRows: Array<{ hash: string }> = [];
  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH);
    const rows = await tracedQuery("transactions.dupes_check", () =>
      supabase
        .from("transactions")
        .select("hash")
        .eq("budget_id", budget_id)
        .in("hash", batch),
    );
    allRows.push(...rows);
  }

  return ok({ duplicate_hashes: allRows.map((r) => r.hash) });
}

export const POST = withLogging(handler, "POST /api/uploads/duplicates");
