import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { created, ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "@/lib/default-categories";

const createBudgetSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  type: z.enum(["personal", "group"]),
});

async function postHandler(req: NextRequest): Promise<Response> {
  const { supabase, user } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { name, type } = createBudgetSchema.parse(body);

  // The AFTER INSERT trigger `create_budget_owner_membership` populates the
  // owner row in budget_members atomically. Do NOT insert into budget_members
  // directly from here — its INSERT policy requires is_budget_owner(), which
  // is the chicken-and-egg problem the trigger exists to solve.
  const budget = await tracedQuery("budgets.create", () =>
    supabase
      .from("budgets")
      .insert({ name, type, owner_id: user.id })
      .select("*")
      .single(),
  );

  // Seed default categories
  const catRows = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      budget_id: budget.id,
      name: c.name,
      type: "expense",
      color: c.color,
      keywords: [...c.keywords],
    })),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({
      budget_id: budget.id,
      name: c.name,
      type: "income",
      color: c.color,
      keywords: [...c.keywords],
    })),
  ];
  try {
    await tracedQuery("categories.seed_defaults", () =>
      supabase.from("categories").insert(catRows).select("id"),
    );
  } catch (err) {
    log().error({
      event: "categories.seed_defaults_failed",
      budgetId: budget.id,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }

  return created({ budget });
}

async function getHandler(): Promise<Response> {
  const { supabase } = await requireUser();

  const budgets = await tracedQuery("budgets.list", () =>
    supabase
      .from("budgets")
      .select("*")
      .order("created_at", { ascending: false }),
  );

  return ok({ budgets });
}

export const POST = withLogging(postHandler, "POST /api/budgets");
export const GET = withLogging(getHandler, "GET /api/budgets");
