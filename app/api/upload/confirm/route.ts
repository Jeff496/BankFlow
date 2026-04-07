import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { created } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";
import {
  categorize,
  prepareRules,
  buildHistoryMap,
  categorizeFromHistory,
} from "@/lib/categorize";
import { categorizeBatchWithLLM } from "@/lib/categorize-llm";

const MAX_ROWS = 5000;

// Single transaction as shipped by the client. Dates are already parsed to
// ISO (YYYY-MM-DD) and amounts are signed numbers (negative = expense).
// Hashes are SHA-256(date|amount|description) computed client-side — the
// server trusts the hash for dedup purposes (re-checks via .in() query).
const transactionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  description: z.string().trim().min(1).max(1000),
  amount: z.number().finite(),
  hash: z.string().regex(/^[0-9a-f]{64}$/, "hash must be 64-char hex (sha256)"),
});

const confirmSchema = z.object({
  budget_id: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  transactions: z
    .array(transactionSchema)
    .min(1, "at least one transaction required")
    .max(MAX_ROWS, `too many rows (max ${MAX_ROWS} per upload)`),
});

async function handler(req: NextRequest): Promise<Response> {
  const { supabase, user } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { budget_id, filename, transactions } = confirmSchema.parse(body);

  log().info({
    event: "upload.received",
    budgetId: budget_id,
    filename,
    rowCount: transactions.length,
  });

  // Server-side dedup (defense in depth — client's preview should already
  // have filtered, but concurrent uploads or client bugs shouldn't poison
  // the budget).
  // Batch .in() to avoid exceeding PostgREST URL length limits
  const proposedHashes = transactions.map((t) => t.hash);
  const DEDUP_BATCH = 100;
  const existingRows: Array<{ hash: string }> = [];
  for (let i = 0; i < proposedHashes.length; i += DEDUP_BATCH) {
    const batch = proposedHashes.slice(i, i + DEDUP_BATCH);
    const rows = await tracedQuery("transactions.check_dupes", () =>
      supabase
        .from("transactions")
        .select("hash")
        .eq("budget_id", budget_id)
        .in("hash", batch),
    );
    existingRows.push(...rows);
  }
  const existingHashes = new Set(existingRows.map((r) => r.hash));
  const toInsert = transactions.filter((t) => !existingHashes.has(t.hash));
  const duplicatesFound = transactions.length - toInsert.length;

  if (toInsert.length === 0) {
    log().info({
      event: "upload.parsed",
      budgetId: budget_id,
      transactionCount: 0,
      duplicatesFound,
      note: "all rows were duplicates, no upload row created",
    });
    return created({
      upload: null,
      inserted_count: 0,
      skipped_duplicates: duplicatesFound,
    });
  }

  // Create the uploads row first so transactions can reference it. RLS on
  // uploads_insert requires uploaded_by = auth.uid() AND is_budget_writer.
  // Archived budget / non-writer → 42501 → 403 RLS_DENIED.
  const upload = await tracedQuery("uploads.create", () =>
    supabase
      .from("uploads")
      .insert({
        budget_id,
        uploaded_by: user.id,
        filename,
        row_count: toInsert.length,
        status: "complete",
      })
      .select("*")
      .single(),
  );

  // Fetch categories for auto-assignment. Ordered ASC by created_at so
  // older categories take precedence in keyword matching (first-match-wins).
  const categories = await tracedQuery("categories.for_categorize", () =>
    supabase
      .from("categories")
      .select("id, name, type, keywords, created_at")
      .eq("budget_id", budget_id)
      .order("created_at", { ascending: true }),
  );

  // Split categories by type for targeted matching
  const expenseCategories = categories.filter((c) => (c.type ?? "expense") === "expense");
  const incomeCategories = categories.filter((c) => (c.type ?? "expense") === "income");
  const expenseRules = prepareRules(expenseCategories);
  const incomeRules = prepareRules(incomeCategories);

  // Fetch previously categorized transactions for history-based matching.
  const history = await tracedQuery("transactions.for_history_match", () =>
    supabase
      .from("transactions")
      .select("description, category_id")
      .eq("budget_id", budget_id)
      .not("category_id", "is", null),
  );
  const historyMap = buildHistoryMap(
    history as Array<{ description: string; category_id: string }>,
  );

  // --- 3-tier categorization ---
  let keywordCount = 0;
  let historyCount = 0;
  let llmCount = 0;
  let newCategoriesCreated = 0;
  const newCategoriesList: Array<{ id: string; name: string }> = [];

  // Map to hold category assignment per index; null = uncategorized so far
  const categoryIds: (string | null)[] = new Array(toInsert.length).fill(null);

  // Collect uncategorized descriptions for LLM (deduplicated), split by type
  const uncategorizedExpenseDescs = new Set<string>();
  const uncategorizedIncomeDescs = new Set<string>();

  // Tier 1 (keywords) + Tier 2 (history)
  for (let i = 0; i < toInsert.length; i++) {
    const desc = toInsert[i].description;
    const isIncome = toInsert[i].amount > 0;
    const rules = isIncome ? incomeRules : expenseRules;

    // Tier 1: keyword match (type-specific categories only)
    const kwMatch = categorize(desc, rules);
    if (kwMatch) {
      categoryIds[i] = kwMatch;
      keywordCount++;
      continue;
    }

    // Tier 2: history match
    if (historyMap.size > 0) {
      const histMatch = categorizeFromHistory(desc, historyMap);
      if (histMatch) {
        categoryIds[i] = histMatch;
        historyCount++;
        continue;
      }
    }

    if (isIncome) {
      uncategorizedIncomeDescs.add(desc);
    } else {
      uncategorizedExpenseDescs.add(desc);
    }
  }

  // Tier 3: LLM batch categorization — run separately for expense and income
  // descriptions so the LLM creates appropriately typed categories.
  async function runLlmTier(
    descs: Set<string>,
    catPool: typeof categories,
    catType: "expense" | "income",
  ) {
    if (descs.size === 0) return;
    const llmResult = await categorizeBatchWithLLM(
      Array.from(descs),
      catPool.map((c) => ({ id: c.id, name: c.name, type: c.type ?? "expense" })),
      catType,
    );

    // Create new categories suggested by the LLM
    const newCatNameToId = new Map<string, string>();
    if (llmResult.newCategories.size > 0) {
      const uniqueNames = new Map<string, string>();
      for (const name of llmResult.newCategories.values()) {
        const key = name.toLowerCase();
        if (!uniqueNames.has(key)) uniqueNames.set(key, name);
      }

      const newCatRows = Array.from(uniqueNames.values()).map((name) => ({
        budget_id,
        name,
        type: catType,
        keywords: [] as string[],
      }));

      try {
        const inserted = await tracedQuery("categories.create_from_llm", () =>
          supabase.from("categories").insert(newCatRows).select("id, name"),
        );
        for (const cat of inserted) {
          newCatNameToId.set(cat.name.toLowerCase(), cat.id);
          newCategoriesList.push({ id: cat.id, name: cat.name });
        }
        newCategoriesCreated += inserted.length;
      } catch (err) {
        log().error({
          event: "llm.categories.create_failed",
          catType,
          reason: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    // Apply LLM results back to uncategorized transactions
    for (let i = 0; i < toInsert.length; i++) {
      if (categoryIds[i] !== null) continue;
      const isIncome = toInsert[i].amount > 0;
      if ((catType === "income") !== isIncome) continue;

      const desc = toInsert[i].description;

      const existingId = llmResult.assignments.get(desc);
      if (existingId) {
        categoryIds[i] = existingId;
        llmCount++;
        continue;
      }

      const newCatName = llmResult.newCategories.get(desc);
      if (newCatName) {
        const newId = newCatNameToId.get(newCatName.toLowerCase());
        if (newId) {
          categoryIds[i] = newId;
          llmCount++;
        }
      }
    }
  }

  // Run LLM for expense and income descriptions (can run in parallel)
  await Promise.all([
    runLlmTier(uncategorizedExpenseDescs, expenseCategories, "expense"),
    runLlmTier(uncategorizedIncomeDescs, incomeCategories, "income"),
  ]);

  const autoCategorized = keywordCount + historyCount + llmCount;

  // Build final insert rows
  const rows = toInsert.map((t, i) => ({
    budget_id,
    upload_id: upload.id,
    uploaded_by: user.id,
    date: t.date,
    description: t.description,
    amount: t.amount,
    hash: t.hash,
    category_id: categoryIds[i],
  }));

  try {
    await tracedQuery("transactions.bulk_insert", () =>
      supabase.from("transactions").insert(rows).select("id"),
    );
  } catch (err) {
    log().error({
      event: "upload.failed",
      budgetId: budget_id,
      uploadId: upload.id,
      reason: err instanceof Error ? err.message : "unknown",
      stack: err instanceof Error ? err.stack : undefined,
    });
    await supabase.from("uploads").delete().eq("id", upload.id);
    throw err;
  }

  log().info({
    event: "upload.parsed",
    budgetId: budget_id,
    uploadId: upload.id,
    transactionCount: toInsert.length,
    duplicatesFound,
    autoCategorized,
    autoKeywordCount: keywordCount,
    autoHistoryCount: historyCount,
    autoLlmCount: llmCount,
    newCategoriesCreated,
  });

  return created({
    upload,
    inserted_count: toInsert.length,
    auto_categorized_count: autoCategorized,
    auto_keyword_count: keywordCount,
    auto_history_count: historyCount,
    auto_llm_count: llmCount,
    new_categories_created: newCategoriesCreated,
    new_categories: newCategoriesList,
    skipped_duplicates: duplicatesFound,
  });
}

export const POST = withLogging(handler, "POST /api/upload/confirm");
