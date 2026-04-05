import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const querySchema = z.object({ budget_id: z.uuid() });

async function handler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    budget_id: url.searchParams.get("budget_id"),
  });
  if (!parsed.success) {
    throw new ValidationError("budget_id query param is required (uuid)");
  }

  // RLS (uploads_select → is_budget_member) filters non-members to an empty
  // array, so passing a budget_id the user can't see just returns [].
  const uploads = await tracedQuery("uploads.list", () =>
    supabase
      .from("uploads")
      .select("id, filename, row_count, status, uploaded_by, created_at")
      .eq("budget_id", parsed.data.budget_id)
      .order("created_at", { ascending: false }),
  );

  return ok({ uploads });
}

export const GET = withLogging(handler, "GET /api/uploads");
