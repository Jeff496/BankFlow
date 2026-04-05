import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { log } from "@/lib/logger";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

// Shape returned by accept_invitation / decline_invitation RPCs
type AcceptResult =
  | { ok: true; budget_id?: string; role?: string }
  | { ok: false; error: string };

function mapRpcError(error: string): Error {
  switch (error) {
    case "not_found":
      return new NotFoundError("invitation not found");
    case "not_for_you":
      return new ForbiddenError("invitation is for another user");
    case "not_pending":
      return new ConflictError("invitation is no longer pending");
    case "expired":
      return new ConflictError("invitation has expired");
    case "user_not_found":
      return new NotFoundError("user profile missing");
    default:
      return new ValidationError(`rpc error: ${error}`);
  }
}

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase, user } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { status } = bodySchema.parse(body);

  const rpcName =
    status === "accepted" ? "accept_invitation" : "decline_invitation";
  const { data, error } = await supabase.rpc(rpcName, {
    p_invitation_id: id,
  });

  if (error) throw error; // mapped by central error handler

  const result = data as AcceptResult;
  if (!result.ok) throw mapRpcError(result.error);

  log().info({
    event: status === "accepted" ? "invite.accepted" : "invite.declined",
    invitationId: id,
    userId: user.id,
    ...(status === "accepted" && "budget_id" in result
      ? { budgetId: result.budget_id }
      : {}),
  });

  return ok({ status, ...(status === "accepted" ? result : {}) });
}

export const PATCH = withLogging<{ id: string }>(
  handler,
  "PATCH /api/invitations/[id]",
);
