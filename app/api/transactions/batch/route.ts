import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const MAX_BATCH = 500;

const bodySchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_BATCH),
  category_id: z.uuid().nullable(),
});

/**
 * Bulk-update category_id on multiple transactions in one UPDATE query.
 * Transactions the user can't write (non-member budgets or archived
 * budgets) are silently filtered out by RLS's USING clause — the response
 * `updated_count` may be less than `ids.length` in that case.
 */
async function handler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { ids, category_id } = bodySchema.parse(body);

  const rows = await tracedQuery("transactions.batch_update", () =>
    supabase
      .from("transactions")
      .update({ category_id })
      .in("id", ids)
      .select("id"),
  );

  return ok({
    requested_count: ids.length,
    updated_count: rows.length,
  });
}

export const PATCH = withLogging(handler, "PATCH /api/transactions/batch");
