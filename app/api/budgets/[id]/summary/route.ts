import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const paramsSchema = z.object({ id: z.uuid() });
const querySchema = z.object({
  start_date: z.string().regex(dateRe, "start_date must be YYYY-MM-DD"),
  end_date: z.string().regex(dateRe, "end_date must be YYYY-MM-DD"),
});

const RECENT_TX_LIMIT = 8;

/**
 * One-shot dashboard summary for a budget + date window. Fetches the raw
 * transactions + categories, aggregates in Node. A month's worth of
 * transactions is small enough (~hundreds) that pulling them back is
 * cheaper than round-tripping separate aggregate queries.
 *
 * RLS filters non-members to empty results at every step.
 */
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  const url = new URL(req.url);
  const { start_date, end_date } = querySchema.parse({
    start_date: url.searchParams.get("start_date"),
    end_date: url.searchParams.get("end_date"),
  });
  if (start_date > end_date) {
    throw new ValidationError("start_date must be <= end_date");
  }

  // Budget access check — also supplies name/type/archived_at/sheet info to the UI.
  const budget = await tracedQuery("dashboard.budget", () =>
    supabase
      .from("budgets")
      .select("id, name, type, archived_at, sheet_id, sheet_last_synced_at")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!budget) throw new NotFoundError("budget not found");

  const [categories, transactions] = await Promise.all([
    tracedQuery("dashboard.categories", () =>
      supabase
        .from("categories")
        .select("id, name, type, color, monthly_limit, created_at")
        .eq("budget_id", id)
        .order("created_at", { ascending: true }),
    ),
    tracedQuery("dashboard.transactions", () =>
      supabase
        .from("transactions")
        .select("id, date, description, amount, category_id, uploaded_by")
        .eq("budget_id", id)
        .gte("date", start_date)
        .lte("date", end_date)
        .order("date", { ascending: false })
        .order("id", { ascending: false }),
    ),
  ]);

  // Build a set of income category IDs for fast lookup
  const catTypeMap = new Map<string, string>();
  for (const c of categories) {
    catTypeMap.set(c.id, c.type ?? "expense");
  }

  // Aggregate — separate income and expense tracking.
  // Expense categories: negative amounts add to spent (positive amounts offset/reduce spent).
  // Income categories: positive amounts add to earned.
  let total_spent = 0;
  let total_income = 0;
  let uncategorized_count = 0;
  const perCategory = new Map<string, { spent: number; count: number }>();
  for (const t of transactions) {
    const amt = Number(t.amount);
    const catType = t.category_id ? catTypeMap.get(t.category_id) ?? "expense" : null;

    if (t.category_id === null) {
      uncategorized_count += 1;
      // Uncategorized expenses still count toward total_spent
      if (amt < 0) total_spent += Math.abs(amt);
    } else {
      const entry = perCategory.get(t.category_id) ?? { spent: 0, count: 0 };
      if (catType === "income") {
        // Income categories: track positive amounts as earned
        entry.spent += Math.abs(amt);
        total_income += Math.abs(amt);
      } else {
        // Expense categories: negative = spending, positive = refund (offsets)
        entry.spent += Math.abs(amt) * (amt < 0 ? 1 : -1);
        total_spent += Math.abs(amt) * (amt < 0 ? 1 : -1);
      }
      entry.count += 1;
      perCategory.set(t.category_id, entry);
    }
  }

  let total_limit = 0;
  const categoriesOut = categories.map((c) => {
    const lim = c.monthly_limit !== null ? Number(c.monthly_limit) : null;
    const isIncome = (c.type ?? "expense") === "income";
    // Only expense categories count toward budget limits
    if (lim !== null && !isIncome) total_limit += lim;
    const agg = perCategory.get(c.id) ?? { spent: 0, count: 0 };
    return {
      id: c.id,
      name: c.name,
      type: c.type ?? "expense",
      color: c.color,
      monthly_limit: lim,
      spent: round2(agg.spent),
      transaction_count: agg.count,
    };
  });

  const metrics = {
    total_spent: round2(total_spent),
    total_income: round2(total_income),
    transaction_count: transactions.length,
    uncategorized_count,
    total_limit: round2(total_limit),
    remaining: round2(total_limit - total_spent),
  };

  const recent_transactions = transactions.slice(0, RECENT_TX_LIMIT);

  return ok({
    budget,
    metrics,
    categories: categoriesOut,
    recent_transactions,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const GET = withLogging<{ id: string }>(
  handler,
  "GET /api/budgets/[id]/summary",
);
