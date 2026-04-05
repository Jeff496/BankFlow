import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { created } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  email: z.email().max(255),
  role: z.enum(["editor", "viewer"]),
});

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase, user } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { email, role } = bodySchema.parse(body);

  // RLS on invitations_insert_owner: invited_by = auth.uid() AND
  // is_budget_owner. Non-owner → 42501 → 403 RLS_DENIED. The policy
  // does NOT check budget type, so invites to personal budgets are
  // technically allowed at the DB layer — we don't gate that here
  // either; the UI only exposes invites for group budgets.
  const inv = await tracedQuery("invitations.create", () =>
    supabase
      .from("invitations")
      .insert({
        budget_id: id,
        invited_by: user.id,
        email: email.toLowerCase(),
        role,
      })
      .select("id, budget_id, email, role, status, expires_at, created_at")
      .single(),
  );

  log().info({
    event: "invite.sent",
    budgetId: id,
    inviteId: inv.id,
    role,
  });

  return created({ invitation: inv });
}

export const POST = withLogging<{ id: string }>(
  handler,
  "POST /api/budgets/[id]/invite",
);
