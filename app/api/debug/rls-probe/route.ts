import type { NextRequest } from "next/server";
import { withLogging } from "@/lib/api/with-logging";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

const ALLOWED_TABLES = [
  "budgets",
  "budget_members",
  "categories",
  "transactions",
  "uploads",
  "invitations",
  "column_mappings",
  "users",
] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

/**
 * Dev-only RLS probe. Runs a minimal `SELECT 1 FROM <table> LIMIT 1` as the
 * current user to confirm whether the JWT is reaching the database and
 * whether policies evaluate as expected. Returns 404 in production.
 */
async function handler(req: NextRequest) {
  if (process.env.VERCEL_ENV === "production") {
    throw new NotFoundError("Not found");
  }

  const url = new URL(req.url);
  const table = url.searchParams.get("table");
  const op = url.searchParams.get("op") ?? "select";

  if (!table || !ALLOWED_TABLES.includes(table as AllowedTable)) {
    throw new ValidationError(
      `table must be one of: ${ALLOWED_TABLES.join(", ")}`,
    );
  }
  if (op !== "select") {
    throw new ValidationError("only op=select is supported");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const start = performance.now();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .limit(1);
  const durationMs = Math.round(performance.now() - start);

  log().debug({
    event: "rls.probe",
    table,
    op,
    durationMs,
    userId: userData.user?.id,
    allowed: !error,
    errorCode: error && "code" in error ? error.code : undefined,
  });

  return Response.json({
    table,
    op,
    userId: userData.user?.id ?? null,
    durationMs,
    allowed: !error,
    rowCount: data?.length ?? 0,
    error: error
      ? {
          code: "code" in error ? error.code : undefined,
          message: error.message,
          hint: "hint" in error ? error.hint : undefined,
        }
      : null,
  });
}

export const GET = withLogging(handler, "GET /api/debug/rls-probe");
