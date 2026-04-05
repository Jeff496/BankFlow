import type { NextRequest } from "next/server";
import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { requireUser } from "@/lib/api/auth";
import { ValidationError } from "@/lib/api/errors";
import { created } from "@/lib/api/response";
import { tracedQuery } from "@/lib/supabase/logged-client";
import { log } from "@/lib/logger";

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
  const proposedHashes = transactions.map((t) => t.hash);
  const existing = await tracedQuery("transactions.check_dupes", () =>
    supabase
      .from("transactions")
      .select("hash")
      .eq("budget_id", budget_id)
      .in("hash", proposedHashes),
  );
  const existingHashes = new Set(existing.map((r) => r.hash));
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

  // Bulk insert transactions. PostgREST bulk insert is atomic per request —
  // all rows succeed or none. On failure, delete the uploads row we just
  // created so we don't leave an orphan "complete" upload with 0 rows.
  const rows = toInsert.map((t) => ({
    budget_id,
    upload_id: upload.id,
    uploaded_by: user.id,
    date: t.date,
    description: t.description,
    amount: t.amount,
    hash: t.hash,
    category_id: null,
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
    // Best-effort cleanup. Uploads cascade-deletes transactions, so even
    // partial inserts (shouldn't happen with atomic bulk insert, but still)
    // are cleaned up.
    await supabase.from("uploads").delete().eq("id", upload.id);
    throw err;
  }

  log().info({
    event: "upload.parsed",
    budgetId: budget_id,
    uploadId: upload.id,
    transactionCount: toInsert.length,
    duplicatesFound,
  });

  return created({
    upload,
    inserted_count: toInsert.length,
    skipped_duplicates: duplicatesFound,
  });
}

export const POST = withLogging(handler, "POST /api/upload/confirm");
