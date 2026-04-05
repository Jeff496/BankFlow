import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { created, ok } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";

// Shape of the stored mapping JSON. Either `amount` (single signed column)
// OR `debit` + `credit` (two columns) must be present; the UI enforces this.
const mappingShapeSchema = z
  .object({
    date: z.string().min(1).max(100),
    description: z.string().min(1).max(100),
    amount: z.string().min(1).max(100).optional(),
    debit: z.string().min(1).max(100).optional(),
    credit: z.string().min(1).max(100).optional(),
    date_format: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]).optional(),
    number_format: z.enum(["US", "EU"]).optional(),
  })
  .refine((m) => !!m.amount || (!!m.debit && !!m.credit), {
    message: "mapping must have either amount or both debit+credit",
  });

const createMappingSchema = z.object({
  bank_name: z.string().trim().min(1).max(100),
  mapping: mappingShapeSchema,
});

async function postHandler(req: NextRequest): Promise<Response> {
  const { supabase, user } = await requireUser();

  const body = await req.json().catch(() => {
    throw new ValidationError("invalid JSON body");
  });
  const { bank_name, mapping } = createMappingSchema.parse(body);

  // UNIQUE (user_id, bank_name) — upsert so "save mapping" overwrites a
  // prior entry with the same bank label instead of 409ing the user.
  const row = await tracedQuery("mappings.upsert", () =>
    supabase
      .from("column_mappings")
      .upsert(
        { user_id: user.id, bank_name, mapping },
        { onConflict: "user_id,bank_name" },
      )
      .select("*")
      .single(),
  );

  return created({ mapping: row });
}

async function getHandler(): Promise<Response> {
  const { supabase } = await requireUser();

  const rows = await tracedQuery("mappings.list", () =>
    supabase
      .from("column_mappings")
      .select("*")
      .order("bank_name", { ascending: true }),
  );

  return ok({ mappings: rows });
}

export const POST = withLogging(postHandler, "POST /api/mappings");
export const GET = withLogging(getHandler, "GET /api/mappings");
