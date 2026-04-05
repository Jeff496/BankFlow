import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import {
  AuthError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";
import {
  createSpreadsheet,
  getSpreadsheet,
  writeTabs,
  TAB_TRANSACTIONS,
  TAB_SUMMARY,
  TAB_SETTINGS,
} from "@/lib/google/sheets";
import { listPermissionEmails, shareFile } from "@/lib/google/drive";
import { GoogleReauthRequiredError } from "@/lib/google/oauth";
import type { GoogleTokens } from "@/lib/google/fetch";

const paramsSchema = z.object({ id: z.uuid() });
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function handler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase, user } = await requireUser();
  const { id: budgetId } = paramsSchema.parse(await params);

  // Get the Google provider tokens. supabase.auth.getSession() reads them
  // from cookies — this is a separate call from getUser() because the
  // session is what carries provider_token.
  const ownedClient = await createClient();
  const { data: sessionData } = await ownedClient.auth.getSession();
  const session = sessionData.session;
  if (!session?.provider_token || !session?.provider_refresh_token) {
    throw new AuthError(
      "Google OAuth provider token missing — sign in with Google to enable Sheets sync",
    );
  }
  const tokens: GoogleTokens = {
    accessToken: session.provider_token,
    refreshToken: session.provider_refresh_token,
  };

  const t0 = performance.now();

  // ---- 1. Verify budget exists + user has access (RLS filters)
  const budget = await tracedQuery("sheets.sync.fetch_budget", () =>
    supabase
      .from("budgets")
      .select("id, name, type, sheet_id, archived_at")
      .eq("id", budgetId)
      .maybeSingle(),
  );
  if (!budget) throw new NotFoundError("budget not found");
  if (budget.archived_at) {
    throw new ForbiddenError("cannot sync archived budgets");
  }

  // ---- 2. Acquire lock: UPDATE with stale-or-null filter. Success = we
  //         set sync_started_at. The WHERE also enforces is_budget_owner
  //         via budgets_update_owner RLS policy, so editors/viewers → 0
  //         rows → 409 (we can't distinguish "in progress" from "not
  //         owner" without a separate query — messaging stays generic).
  const fiveMinAgoIso = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const { data: lockRow } = await supabase
    .from("budgets")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("id", budgetId)
    .or(`sync_started_at.is.null,sync_started_at.lt.${fiveMinAgoIso}`)
    .select("id")
    .maybeSingle();
  if (!lockRow) {
    throw new ConflictError(
      "sync in progress (or you're not the budget owner)",
    );
  }

  log().info({
    event: "sheets.sync.start",
    budgetId,
    sheetId: budget.sheet_id,
  });

  try {
    // ---- 3. Fetch everything we need for the three tabs in parallel
    const [categories, transactions, members] = await Promise.all([
      tracedQuery("sheets.sync.categories", () =>
        supabase
          .from("categories")
          .select("id, name, monthly_limit, color, created_at")
          .eq("budget_id", budgetId)
          .order("created_at", { ascending: true }),
      ),
      tracedQuery("sheets.sync.transactions", () =>
        supabase
          .from("transactions")
          .select("id, date, description, amount, category_id, uploaded_by")
          .eq("budget_id", budgetId)
          .order("date", { ascending: false })
          .order("id", { ascending: false }),
      ),
      tracedQuery("sheets.sync.members", () =>
        supabase
          .from("budget_members")
          .select("user_id, role, users(email, display_name)")
          .eq("budget_id", budgetId),
      ),
    ]);

    // ---- 4. Build the tab contents
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const userMap = new Map(
      members.map((m) => [m.user_id, m.users] as const),
    );

    const transactionsTab = buildTransactionsTab(
      transactions,
      catMap,
      userMap,
    );
    const summaryTab = buildSummaryTab(categories, transactions);
    const settingsTab = buildSettingsTab(budget.name, members);

    // ---- 5. Create or reuse the spreadsheet
    let spreadsheetId = budget.sheet_id;
    let isNewSheet = false;
    if (!spreadsheetId) {
      const created = await createSpreadsheet(
        tokens,
        `BankFlow — ${budget.name}`,
      );
      spreadsheetId = created.spreadsheetId;
      isNewSheet = true;
    } else {
      // If the sheet was deleted out-of-band, this throws. User retries
      // after clearing sheet_id or we could null+recreate here. MVP: throw.
      await getSpreadsheet(tokens, spreadsheetId);
    }

    // ---- 6. Write all three tabs
    await writeTabs(tokens, spreadsheetId, [
      { title: TAB_TRANSACTIONS, values: transactionsTab },
      { title: TAB_SUMMARY, values: summaryTab },
      { title: TAB_SETTINGS, values: settingsTab },
    ]);

    // ---- 7. Share with group-budget members (skip already-shared)
    if (budget.type === "group") {
      const existing = await listPermissionEmails(tokens, spreadsheetId);
      const ownerEmail = user.email?.toLowerCase();
      for (const m of members) {
        const email = m.users?.email?.toLowerCase();
        if (!email) continue;
        if (email === ownerEmail) continue; // owner already has access
        if (existing.has(email)) continue;
        try {
          await shareFile(tokens, spreadsheetId, email);
        } catch (err) {
          // Sharing is best-effort — don't abort the whole sync if one
          // invite fails (e.g. email doesn't have a Google account).
          log().warn({
            event: "sheets.sync.share_failed",
            budgetId,
            email,
            err: err instanceof Error ? err.message : "unknown",
          });
        }
      }
    }

    // ---- 8. Persist sheet_id (if new) + release lock + timestamp
    await tracedQuery("sheets.sync.release_lock", () =>
      supabase
        .from("budgets")
        .update({
          sheet_id: spreadsheetId,
          sheet_last_synced_at: new Date().toISOString(),
          sync_started_at: null,
        })
        .eq("id", budgetId)
        .select("id")
        .single(),
    );

    const durationMs = Math.round(performance.now() - t0);
    log().info({
      event: "sheets.sync.done",
      budgetId,
      sheetId: spreadsheetId,
      durationMs,
      isNewSheet,
      rowsWritten: transactions.length,
    });

    return ok({
      spreadsheet_id: spreadsheetId,
      spreadsheet_url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      synced_at: new Date().toISOString(),
      is_new_sheet: isNewSheet,
      rows_written: transactions.length,
    });
  } catch (err) {
    // Release lock on failure so the user can retry without waiting for TTL
    await supabase
      .from("budgets")
      .update({ sync_started_at: null })
      .eq("id", budgetId);

    const durationMs = Math.round(performance.now() - t0);
    log().error({
      event: "sheets.sync.fail",
      budgetId,
      durationMs,
      err: err instanceof Error ? err.message : "unknown",
      stack: err instanceof Error ? err.stack : undefined,
    });

    if (err instanceof GoogleReauthRequiredError) throw err;
    throw err;
  }
}

// ---------- tab builders ----------

type UserLite = { email: string; display_name: string | null } | null;

function buildTransactionsTab(
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    amount: string | number;
    category_id: string | null;
    uploaded_by: string;
  }>,
  catMap: Map<string, { name: string }>,
  userMap: Map<string, UserLite>,
): (string | number | null)[][] {
  const header = ["Date", "Description", "Amount", "Category", "Uploaded By"];
  const rows: (string | number | null)[][] = [header];
  for (const t of transactions) {
    const cat = t.category_id ? catMap.get(t.category_id)?.name ?? "" : "";
    const uploader = userMap.get(t.uploaded_by);
    const uploaderName =
      uploader?.display_name ?? uploader?.email ?? t.uploaded_by;
    rows.push([t.date, t.description, Number(t.amount), cat, uploaderName]);
  }
  return rows;
}

function buildSummaryTab(
  categories: Array<{ id: string; name: string; monthly_limit: string | number | null }>,
  transactions: Array<{ category_id: string | null; amount: string | number }>,
): (string | number | null)[][] {
  const spendByCat = new Map<string, number>();
  let uncategorized = 0;
  for (const t of transactions) {
    const amt = Number(t.amount);
    if (amt >= 0) continue; // only expenses
    const abs = Math.abs(amt);
    if (t.category_id === null) {
      uncategorized += abs;
    } else {
      spendByCat.set(
        t.category_id,
        (spendByCat.get(t.category_id) ?? 0) + abs,
      );
    }
  }

  const header = ["Category", "Limit", "Spent", "Remaining", "% Used"];
  const rows: (string | number | null)[][] = [header];
  for (const c of categories) {
    const limit = c.monthly_limit !== null ? Number(c.monthly_limit) : null;
    const spent = spendByCat.get(c.id) ?? 0;
    const remaining = limit !== null ? round2(limit - spent) : null;
    const pctUsed =
      limit !== null && limit > 0 ? round2((spent / limit) * 100) : null;
    rows.push([c.name, limit, round2(spent), remaining, pctUsed]);
  }
  if (uncategorized > 0) {
    rows.push(["Uncategorized", null, round2(uncategorized), null, null]);
  }
  return rows;
}

function buildSettingsTab(
  budgetName: string,
  members: Array<{
    role: string;
    users: { email: string; display_name: string | null } | null;
  }>,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [
    ["Budget", budgetName],
    ["Last synced", new Date().toISOString()],
    [""],
    ["Members"],
    ["Name", "Email", "Role"],
  ];
  for (const m of members) {
    rows.push([
      m.users?.display_name ?? "",
      m.users?.email ?? "",
      m.role,
    ]);
  }
  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const POST = withLogging<{ id: string }>(
  handler,
  "POST /api/sheets/sync/[id]",
);
