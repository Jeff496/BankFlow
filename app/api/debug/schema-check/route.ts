import { withLogging } from "@/lib/api/with-logging";
import { NotFoundError, AuthError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

/**
 * Dev-only probe that exercises the Step 3 verification checks against the
 * authenticated user's JWT:
 *   - inserts a throwaway personal budget, confirms the owner-membership
 *     trigger fired, verifies updated_at is bumped on rename, confirms the
 *     duplicate-member unique constraint fires (23505), then cleans up.
 * Returns a JSON report. Returns 404 in production.
 */
async function handler(): Promise<Response> {
  if (process.env.VERCEL_ENV === "production") {
    throw new NotFoundError("Not found");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new AuthError("sign in first");

  const report: Record<string, unknown> = { userId: user.id };

  // 0a. Diagnostic: echo auth.uid() as the DB sees it. If this doesn't match
  //     user.id, the JWT isn't reaching the DB and every RLS check will fail.
  const { data: dbUid, error: uidErr } = await supabase.rpc("current_user_uid");
  report.authUidFromDb = {
    ok: dbUid === user.id,
    dbUid,
    matches: dbUid === user.id,
    error: uidErr,
  };

  // 0b. Diagnostic: print the DB-side session info (role, jwt_sub, etc.)
  const { data: sessionInfo } = await supabase.rpc("debug_session_info");
  report.dbSessionInfo = sessionInfo;

  // 0c. Diagnostic: try the INSERT from *inside* the DB so we isolate
  //     client-transport issues from policy issues.
  const { data: innerInsert } = await supabase.rpc("debug_try_insert_budget");
  report.innerInsertAttempt = innerInsert;

  // 1. Insert a throwaway budget
  const { data: budget, error: insertErr } = await supabase
    .from("budgets")
    .insert({ name: "__schema_check__", type: "personal", owner_id: user.id })
    .select("id, created_at, updated_at")
    .single();

  if (insertErr || !budget) {
    report.insert = { ok: false, error: insertErr };
    return Response.json(report, { status: 200 });
  }
  report.insert = { ok: true, budgetId: budget.id };

  try {
    // 2. Verify owner-membership trigger fired
    const { data: members } = await supabase
      .from("budget_members")
      .select("user_id, role")
      .eq("budget_id", budget.id);
    report.ownerTrigger = {
      ok: members?.length === 1 && members[0]?.role === "owner" && members[0]?.user_id === user.id,
      rows: members ?? [],
    };

    // 3. Verify duplicate (budget_id, user_id) → 23505
    const { error: dupErr } = await supabase
      .from("budget_members")
      .insert({ budget_id: budget.id, user_id: user.id, role: "editor" });
    report.uniqueConstraint = {
      ok: !!dupErr && "code" in dupErr && dupErr.code === "23505",
      code: dupErr && "code" in dupErr ? dupErr.code : null,
    };

    // 4. Verify updated_at trigger
    // Wait 10ms to ensure a distinguishable timestamp
    await new Promise((r) => setTimeout(r, 10));
    const { data: renamed } = await supabase
      .from("budgets")
      .update({ name: "__schema_check_renamed__" })
      .eq("id", budget.id)
      .select("created_at, updated_at")
      .single();
    report.updatedAtTrigger = {
      ok: renamed
        ? new Date(renamed.updated_at).getTime() > new Date(renamed.created_at).getTime()
        : false,
      created_at: renamed?.created_at,
      updated_at: renamed?.updated_at,
    };

    // 5. Verify is_budget_member via an RPC-style call through a select
    const { data: memberCheck } = await supabase
      .from("budgets")
      .select("id")
      .eq("id", budget.id)
      .maybeSingle();
    report.rlsSelect = {
      ok: memberCheck?.id === budget.id,
    };

    // 6. Verify archived-budget blocks writes
    await supabase
      .from("budgets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", budget.id);
    const { error: archivedWriteErr } = await supabase
      .from("categories")
      .insert({ budget_id: budget.id, name: "should_fail" });
    report.archivedBlocksWrite = {
      ok: !!archivedWriteErr,
      code: archivedWriteErr && "code" in archivedWriteErr ? archivedWriteErr.code : null,
    };
  } finally {
    // Cleanup: DELETE the budget (cascades to members, categories, etc.)
    // Need to un-archive first since even DELETE on archived rows requires owner.
    // (Owner DELETE policy only checks is_budget_owner, not archived_at, so this works.)
    await supabase.from("budgets").delete().eq("id", budget.id);
  }

  log().info({ event: "schema.check", report });
  return Response.json(report);
}

export const GET = withLogging(handler, "GET /api/debug/schema-check");
