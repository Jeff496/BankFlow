import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";
import {
  categorize,
  prepareRules,
  buildHistoryMap,
  categorizeFromHistory,
} from "@/lib/categorize";
import { categorizeBatchWithLLM } from "@/lib/categorize-llm";

const bodySchema = z.object({
  budget_id: z.uuid(),
});

/**
 * Re-run 3-tier categorization on all uncategorized transactions in a budget.
 * Useful after users add new categories or keywords — picks up matches the
 * original import missed.
 */
async function handler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();
  const body = await req.json().catch(() => {
    throw new Error("invalid JSON body");
  });
  const { budget_id } = bodySchema.parse(body);

  // Fetch uncategorized transactions
  const uncategorized = await tracedQuery("recategorize.fetch_uncategorized", () =>
    supabase
      .from("transactions")
      .select("id, description, amount")
      .eq("budget_id", budget_id)
      .is("category_id", null)
      .order("date", { ascending: false }),
  );

  if (uncategorized.length === 0) {
    return ok({ recategorized_count: 0, total_uncategorized: 0 });
  }

  // Fetch categories split by type
  const categories = await tracedQuery("recategorize.fetch_categories", () =>
    supabase
      .from("categories")
      .select("id, name, type, keywords, created_at")
      .eq("budget_id", budget_id)
      .order("created_at", { ascending: true }),
  );

  const expenseCats = categories.filter((c) => (c.type ?? "expense") === "expense");
  const incomeCats = categories.filter((c) => (c.type ?? "expense") === "income");
  const expenseRules = prepareRules(expenseCats);
  const incomeRules = prepareRules(incomeCats);

  // History map from previously categorized transactions
  const history = await tracedQuery("recategorize.fetch_history", () =>
    supabase
      .from("transactions")
      .select("description, category_id")
      .eq("budget_id", budget_id)
      .not("category_id", "is", null),
  );
  const historyMap = buildHistoryMap(
    history as Array<{ description: string; category_id: string }>,
  );

  // Run 3-tier categorization
  let keywordCount = 0;
  let historyCount = 0;
  let llmCount = 0;
  const assignments: Array<{ id: string; category_id: string }> = [];
  const uncatExpenseDescs = new Set<string>();
  const uncatIncomeDescs = new Set<string>();

  for (const tx of uncategorized) {
    const isIncome = Number(tx.amount) > 0;
    const rules = isIncome ? incomeRules : expenseRules;

    // Tier 1: keywords
    const kwMatch = categorize(tx.description, rules);
    if (kwMatch) {
      assignments.push({ id: tx.id, category_id: kwMatch });
      keywordCount++;
      continue;
    }

    // Tier 2: history
    if (historyMap.size > 0) {
      const histMatch = categorizeFromHistory(tx.description, historyMap);
      if (histMatch) {
        assignments.push({ id: tx.id, category_id: histMatch });
        historyCount++;
        continue;
      }
    }

    if (isIncome) uncatIncomeDescs.add(tx.description);
    else uncatExpenseDescs.add(tx.description);
  }

  // Tier 3: LLM
  async function runLlm(descs: Set<string>, catPool: typeof categories) {
    if (descs.size === 0 || catPool.length === 0) return;
    const llmAssignments = await categorizeBatchWithLLM(
      Array.from(descs),
      catPool.map((c) => ({ id: c.id, name: c.name })),
    );

    for (const tx of uncategorized) {
      if (assignments.some((a) => a.id === tx.id)) continue;
      const catId = llmAssignments.get(tx.description);
      if (catId) {
        assignments.push({ id: tx.id, category_id: catId });
        llmCount++;
      }
    }
  }

  await Promise.all([
    runLlm(uncatExpenseDescs, expenseCats),
    runLlm(uncatIncomeDescs, incomeCats),
  ]);

  // Bulk update — group by category_id to minimize queries
  const byCat = new Map<string, string[]>();
  for (const a of assignments) {
    const ids = byCat.get(a.category_id) ?? [];
    ids.push(a.id);
    byCat.set(a.category_id, ids);
  }

  const BATCH = 100;
  for (const [catId, txIds] of byCat) {
    for (let i = 0; i < txIds.length; i += BATCH) {
      const batch = txIds.slice(i, i + BATCH);
      await tracedQuery("recategorize.batch_update", () =>
        supabase
          .from("transactions")
          .update({ category_id: catId })
          .in("id", batch)
          .select("id"),
      );
    }
  }

  log().info({
    event: "recategorize.done",
    budgetId: budget_id,
    totalUncategorized: uncategorized.length,
    recategorized: assignments.length,
    keywordCount,
    historyCount,
    llmCount,
  });

  return ok({
    recategorized_count: assignments.length,
    total_uncategorized: uncategorized.length,
    keyword_count: keywordCount,
    history_count: historyCount,
    llm_count: llmCount,
  });
}

export const POST = withLogging(handler, "POST /api/transactions/recategorize");
