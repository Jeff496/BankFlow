import { hashTransaction } from "./hash";
import { parseDate, parseNumber } from "./format";
import type { DateFormat, NumberFormat } from "./format";

export interface ColumnMapping {
  dateIdx: number;
  descriptionIdx: number;
  /** Either amountIdx OR (debitIdx + creditIdx). */
  amountIdx: number | null;
  debitIdx: number | null;
  creditIdx: number | null;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

export interface TransformedRow {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed
  hash: string;
}

export interface TransformResult {
  rows: TransformedRow[];
  /** Input-row indices that failed to parse (with the reason). */
  errors: { rowIndex: number; reason: string }[];
}

/**
 * Apply a user-confirmed column mapping to raw CSV rows, producing the
 * transaction payload shape the confirm API expects. Each row that fails
 * to parse is captured in `errors` but doesn't abort the batch — the user
 * can see skipped rows in the preview.
 *
 * Debit/credit split: debit column values become negative amounts (expense),
 * credit column values become positive (income). Empty cells in a split
 * column are ignored.
 */
export async function transformRows(
  rows: string[][],
  mapping: ColumnMapping,
): Promise<TransformResult> {
  const out: TransformedRow[] = [];
  const errors: { rowIndex: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      const date = parseDate(
        row[mapping.dateIdx] ?? "",
        mapping.dateFormat,
      );
      const description = (row[mapping.descriptionIdx] ?? "").trim();
      if (!description) throw new Error("description is empty");

      let amount: number;
      if (mapping.amountIdx !== null) {
        amount = parseNumber(
          row[mapping.amountIdx] ?? "",
          mapping.numberFormat,
        );
      } else if (mapping.debitIdx !== null && mapping.creditIdx !== null) {
        const debitRaw = (row[mapping.debitIdx] ?? "").trim();
        const creditRaw = (row[mapping.creditIdx] ?? "").trim();
        if (debitRaw) {
          amount = -Math.abs(parseNumber(debitRaw, mapping.numberFormat));
        } else if (creditRaw) {
          amount = Math.abs(parseNumber(creditRaw, mapping.numberFormat));
        } else {
          throw new Error("both debit and credit are empty");
        }
      } else {
        throw new Error("no amount mapping configured");
      }

      const hash = await hashTransaction(date, amount, description);
      out.push({ date, description, amount, hash });
    } catch (err) {
      errors.push({
        rowIndex: i,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { rows: out, errors };
}
