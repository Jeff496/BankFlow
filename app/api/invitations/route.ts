import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

async function handler(): Promise<Response> {
  const { supabase } = await requireUser();

  // Uses a SECURITY DEFINER RPC because invitees can't SELECT from `budgets`
  // (RLS) until they accept. The function joins invitations -> budgets ->
  // users and returns only rows addressed to the caller, status=pending,
  // not expired.
  const invitations = await tracedQuery("invitations.list", () =>
    supabase.rpc("list_my_pending_invitations"),
  );

  return ok({ invitations });
}

export const GET = withLogging(handler, "GET /api/invitations");
