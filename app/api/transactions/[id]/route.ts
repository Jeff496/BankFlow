import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { noContent, ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const paramsSchema = z.object({ id: z.uuid() });

// Only category_id is editable on a transaction. Date/amount/description/hash
// are audit-of-record from the bank CSV and should not be edited — re-upload
// instead. null clears the category (uncategorizes).
const patchSchema = z.object({
  category_id: z.uuid().nullable(),
});

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { category_id } = patchSchema.parse(body);

  // RLS USING on transactions_update uses is_budget_writer — archived or
  // non-writer budgets silently filter out the row → 0 updates → PGRST116
  // → 404 NOT_FOUND (per mvp.md: "RLS should hide, not 403").
  const row = await tracedQuery("transactions.update", () =>
    supabase
      .from("transactions")
      .update({ category_id })
      .eq("id", id)
      .select("id, category_id, updated_at")
      .single(),
  );

  return ok({ transaction: row });
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  await tracedQuery("transactions.delete", () =>
    supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .select("id")
      .single(),
  );

  return noContent();
}

export const PATCH = withLogging<{ id: string }>(
  patchHandler,
  "PATCH /api/transactions/[id]",
);
export const DELETE = withLogging<{ id: string }>(
  deleteHandler,
  "DELETE /api/transactions/[id]",
);
