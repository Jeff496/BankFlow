import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const paramsSchema = z.object({ id: z.uuid() });

async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  // budget_members_select restricts to is_budget_member; users RLS policy
  // `users_select_peers` lets budget peers see each other's profiles. So a
  // member of the budget can see all other members + their names/emails.
  const members = await tracedQuery("members.list", () =>
    supabase
      .from("budget_members")
      .select("id, user_id, role, joined_at, users(id, email, display_name)")
      .eq("budget_id", id)
      .order("joined_at", { ascending: true }),
  );

  return ok({ members });
}

export const GET = withLogging<{ id: string }>(
  handler,
  "GET /api/budgets/[id]/members",
);
