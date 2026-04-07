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
});

/**
 * Bulk-delete transactions by ID. RLS filters out rows the user can't
 * write — deleted_count may be less than ids.length.
 */
async function handler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { ids } = bodySchema.parse(body);

  // Batch in chunks of 100 to avoid URL length limits
  let deletedCount = 0;
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const rows = await tracedQuery("transactions.batch_delete", () =>
      supabase
        .from("transactions")
        .delete()
        .in("id", batch)
        .select("id"),
    );
    deletedCount += rows.length;
  }

  return ok({
    requested_count: ids.length,
    deleted_count: deletedCount,
  });
}

export const POST = withLogging(handler, "POST /api/transactions/batch-delete");
