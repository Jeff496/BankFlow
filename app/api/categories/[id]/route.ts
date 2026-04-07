import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { noContent, ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const paramsSchema = z.object({ id: z.uuid() });

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(100).optional(),
    type: z.enum(["expense", "income"]).optional(),
    excluded: z.boolean().optional(),
    monthly_limit: z.number().nonnegative().nullable().optional(),
    keywords: z
      .array(z.string().trim().min(1).max(200))
      .max(50)
      .optional(),
    color: z
      .string()
      .regex(HEX_COLOR_RE, "color must be a 6-char hex code")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field must be provided",
  });

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const patch = updateCategorySchema.parse(body);

  // RLS USING hides rows on archived budgets or for non-writers → PGRST116 → 404.
  const category = await tracedQuery("categories.update", () =>
    supabase
      .from("categories")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single(),
  );

  return ok({ category });
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { supabase } = await requireUser();
  const { id } = paramsSchema.parse(await params);

  // transactions.category_id has ON DELETE SET NULL, so orphaned transactions
  // are soft-unlinked automatically (no explicit UPDATE needed here).
  await tracedQuery("categories.delete", () =>
    supabase
      .from("categories")
      .delete()
      .eq("id", id)
      .select("id")
      .single(),
  );

  return noContent();
}

export const PATCH = withLogging<{ id: string }>(
  patchHandler,
  "PATCH /api/categories/[id]",
);
export const DELETE = withLogging<{ id: string }>(
  deleteHandler,
  "DELETE /api/categories/[id]",
);
