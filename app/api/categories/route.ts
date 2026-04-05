import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { created } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const createCategorySchema = z.object({
  budget_id: z.uuid(),
  name: z.string().trim().min(1, "name is required").max(100),
  monthly_limit: z.number().nonnegative().nullable().optional(),
  keywords: z
    .array(z.string().trim().min(1).max(200))
    .max(50)
    .optional(),
  color: z
    .string()
    .regex(HEX_COLOR_RE, "color must be a 6-char hex code")
    .optional(),
});

async function postHandler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const parsed = createCategorySchema.parse(body);

  // is_budget_writer() on the INSERT policy filters out non-members and
  // archived budgets → 42501 → RLS_DENIED (403).
  const category = await tracedQuery("categories.create", () =>
    supabase
      .from("categories")
      .insert({
        budget_id: parsed.budget_id,
        name: parsed.name,
        monthly_limit: parsed.monthly_limit ?? null,
        keywords: parsed.keywords ?? [],
        ...(parsed.color ? { color: parsed.color } : {}),
      })
      .select("*")
      .single(),
  );

  return created({ category });
}

export const POST = withLogging(postHandler, "POST /api/categories");
