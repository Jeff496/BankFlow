import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ConflictError } from "@/lib/api/errors";
import { noContent } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";

const paramsSchema = z.object({ id: z.uuid(), userId: z.uuid() });

async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
): Promise<Response> {
  const { supabase, user } = await requireUser();
  const { id: budgetId, userId } = paramsSchema.parse(await params);

  // Block self-removal if the caller is the budget's owner — otherwise the
  // budget becomes orphaned (no one can un-archive / delete / invite).
  // RLS alone can't enforce this; check here.
  if (userId === user.id) {
    const { data: myMembership } = await supabase
      .from("budget_members")
      .select("role")
      .eq("budget_id", budgetId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (myMembership?.role === "owner") {
      throw new ConflictError(
        "owners cannot leave their own budget — transfer ownership or delete the budget first",
      );
    }
  }

  // budget_members_delete policy: is_budget_owner OR user_id = auth.uid().
  // Non-owner kicking someone else → 0 rows → PGRST116 → 404.
  await tracedQuery("members.delete", () =>
    supabase
      .from("budget_members")
      .delete()
      .eq("budget_id", budgetId)
      .eq("user_id", userId)
      .select("id")
      .single(),
  );

  log().info({
    event: "member.removed",
    budgetId,
    removedUserId: userId,
    byUserId: user.id,
    selfRemoved: userId === user.id,
  });

  return noContent();
}

export const DELETE = withLogging<{ id: string; userId: string }>(
  handler,
  "DELETE /api/budgets/[id]/members/[userId]",
);
