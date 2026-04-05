import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { noContent, ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const paramsSchema = z.object({ id: z.uuid() });

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  // RLS limits visibility to owner/members; non-member → PGRST116 → 404.
  const budget = await tracedQuery("budgets.get", () =>
    supabase.from("budgets").select("*").eq("id", id).single(),
  );

  return ok({ budget });
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  // Soft-delete: set archived_at. Only owners pass the update policy
  // (is_budget_owner). Non-owners → 0 rows updated → PGRST116 → 404.
  await tracedQuery("budgets.archive", () =>
    supabase
      .from("budgets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single(),
  );

  return noContent();
}

export const GET = withLogging<{ id: string }>(
  getHandler,
  "GET /api/budgets/[id]",
);
export const DELETE = withLogging<{ id: string }>(
  deleteHandler,
  "DELETE /api/budgets/[id]",
);
