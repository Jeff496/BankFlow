import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  budget_id: z.uuid(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  uncategorized: z.coerce.boolean().optional(),
  category_id: z.uuid().optional(),
  start_date: z.string().regex(dateRe, "start_date must be YYYY-MM-DD").optional(),
  end_date: z.string().regex(dateRe, "end_date must be YYYY-MM-DD").optional(),
});

interface Cursor {
  date: string;
  id: string;
}

function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new ValidationError("invalid cursor");
  }
  const underscoreIdx = decoded.indexOf("_");
  if (underscoreIdx === -1) throw new ValidationError("invalid cursor");
  const date = decoded.slice(0, underscoreIdx);
  const id = decoded.slice(underscoreIdx + 1);
  if (!dateRe.test(date) || id.length === 0) {
    throw new ValidationError("invalid cursor");
  }
  return { date, id };
}

function encodeCursor(row: { date: string; id: string }): string {
  return Buffer.from(`${row.date}_${row.id}`).toString("base64");
}

async function handler(req: NextRequest): Promise<Response> {
  const { supabase } = await requireUser();

  const url = new URL(req.url);
  const params = querySchema.parse({
    budget_id: url.searchParams.get("budget_id"),
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    uncategorized: url.searchParams.get("uncategorized") ?? undefined,
    category_id: url.searchParams.get("category_id") ?? undefined,
    start_date: url.searchParams.get("start_date") ?? undefined,
    end_date: url.searchParams.get("end_date") ?? undefined,
  });

  let query = supabase
    .from("transactions")
    .select("id, date, description, amount, category_id, upload_id, uploaded_by, created_at, updated_at")
    .eq("budget_id", params.budget_id);

  if (params.uncategorized) {
    query = query.is("category_id", null);
  } else if (params.category_id) {
    query = query.eq("category_id", params.category_id);
  }
  if (params.start_date) query = query.gte("date", params.start_date);
  if (params.end_date) query = query.lte("date", params.end_date);

  if (params.cursor) {
    const { date, id } = decodeCursor(params.cursor);
    // Keyset pagination: (date, id) < (cursor.date, cursor.id) under
    // DESC DESC ordering. Expressed as: date < cursor.date OR
    // (date = cursor.date AND id < cursor.id).
    query = query.or(
      `date.lt.${date},and(date.eq.${date},id.lt.${id})`,
    );
  }

  // Fetch limit + 1 so we can tell if there's a next page without a count.
  const rows = await tracedQuery("transactions.list", () =>
    query
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .limit(params.limit + 1),
  );

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor =
    hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null;

  return ok({ transactions: page, nextCursor });
}

export const GET = withLogging(handler, "GET /api/transactions");
