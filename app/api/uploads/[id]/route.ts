import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { noContent } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const paramsSchema = z.object({ id: z.uuid() });

async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  // transactions has FK (upload_id) REFERENCES uploads(id) ON DELETE CASCADE,
  // so deleting the uploads row removes its transactions in one shot.
  // RLS on uploads_delete uses is_budget_writer — archived budgets and
  // non-writers get 0 rows deleted → PGRST116 → 404.
  await tracedQuery("uploads.delete", () =>
    supabase
      .from("uploads")
      .delete()
      .eq("id", id)
      .select("id")
      .single(),
  );

  return noContent();
}

export const DELETE = withLogging<{ id: string }>(
  handler,
  "DELETE /api/uploads/[id]",
);
