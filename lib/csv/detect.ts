import type { DateFormat, NumberFormat } from "./format";

export interface ColumnDetection {
  dateIdx: number | null;
  descriptionIdx: number | null;
  amountIdx: number | null;
  debitIdx: number | null;
  creditIdx: number | null;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

const DATE_RE =
  /^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/;
const NUMBER_RE = /^\s*[-+(]?\s*[\d.,\s]*\d[\d.,\s]*[)]?\s*$/;

// Heuristic thresholds. A column is considered "likely X" if at least this
// fraction of its non-empty cells match the pattern for X.
const MATCH_THRESHOLD = 0.7;

/**
 * Auto-detect which columns hold the date, description, and amount (or
 * debit/credit split) from a parsed CSV. Also infers date + number format
 * from the data so we can parse them without asking the user.
 *
 * Returns indices and formats. Any field may be null if detection fails —
 * the UI should prompt the user to fill in the blanks via dropdowns.
 */
export function detectColumns(
  headers: string[],
  rows: string[][],
): ColumnDetection {
  const sampleRows = rows.slice(0, 100); // enough signal, bounded work
  const colCount = headers.length;

  const dateScore: number[] = new Array(colCount).fill(0);
  const numericScore: number[] = new Array(colCount).fill(0);
  const avgLen: number[] = new Array(colCount).fill(0);
  const nonEmpty: number[] = new Array(colCount).fill(0);

  for (const row of sampleRows) {
    for (let c = 0; c < colCount; c++) {
      const cell = (row[c] ?? "").trim();
      if (!cell) continue;
      nonEmpty[c]! += 1;
      avgLen[c]! += cell.length;
      if (DATE_RE.test(cell)) dateScore[c]! += 1;
      if (NUMBER_RE.test(cell)) numericScore[c]! += 1;
    }
  }
  for (let c = 0; c < colCount; c++) {
    if (nonEmpty[c]! > 0) avgLen[c]! = avgLen[c]! / nonEmpty[c]!;
  }

  // --- Date: highest date-match ratio above threshold
  const dateIdx = pickColumn(dateScore, nonEmpty, MATCH_THRESHOLD);

  // --- Header-name hints for debit/credit split (common bank CSV pattern)
  const headerLc = headers.map((h) => h.toLowerCase());
  const debitHint = findByHeader(headerLc, ["debit", "withdrawal", "withdrawals", "paid out"]);
  const creditHint = findByHeader(headerLc, ["credit", "deposit", "deposits", "paid in"]);
  const hasSplit =
    debitHint !== null &&
    creditHint !== null &&
    numericScore[debitHint]! / Math.max(nonEmpty[debitHint]!, 1) >= 0.3 &&
    numericScore[creditHint]! / Math.max(nonEmpty[creditHint]!, 1) >= 0.3;

  let amountIdx: number | null = null;
  let debitIdx: number | null = null;
  let creditIdx: number | null = null;

  if (hasSplit) {
    debitIdx = debitHint;
    creditIdx = creditHint;
  } else {
    // Single amount column: prefer a header-name match, fall back to highest
    // numeric-score column that isn't the date column.
    const amountHint = findByHeader(headerLc, [
      "amount",
      "transaction amount",
      "value",
    ]);
    if (
      amountHint !== null &&
      amountHint !== dateIdx &&
      numericScore[amountHint]! / Math.max(nonEmpty[amountHint]!, 1) >= 0.3
    ) {
      amountIdx = amountHint;
    } else {
      const scores = numericScore.map((s, i) =>
        i === dateIdx ? -1 : s / Math.max(nonEmpty[i]!, 1),
      );
      amountIdx = argmax(scores, MATCH_THRESHOLD);
    }
  }

  // --- Description: longest average string length among remaining columns
  const taken = new Set<number | null>([
    dateIdx,
    amountIdx,
    debitIdx,
    creditIdx,
  ]);
  let descriptionIdx: number | null = null;
  let maxLen = 0;
  for (let c = 0; c < colCount; c++) {
    if (taken.has(c)) continue;
    if (nonEmpty[c]! === 0) continue;
    if (avgLen[c]! > maxLen) {
      maxLen = avgLen[c]!;
      descriptionIdx = c;
    }
  }

  const dateSamples = dateIdx !== null ? columnValues(sampleRows, dateIdx) : [];
  const numSamples =
    amountIdx !== null
      ? columnValues(sampleRows, amountIdx)
      : debitIdx !== null
        ? columnValues(sampleRows, debitIdx)
        : [];

  return {
    dateIdx,
    descriptionIdx,
    amountIdx,
    debitIdx,
    creditIdx,
    dateFormat: detectDateFormat(dateSamples),
    numberFormat: detectNumberFormat(numSamples),
  };
}

function columnValues(rows: string[][], col: number): string[] {
  return rows
    .map((r) => (r[col] ?? "").trim())
    .filter((s) => s.length > 0);
}

function pickColumn(
  scores: number[],
  nonEmpty: number[],
  threshold: number,
): number | null {
  let best = -1;
  let bestScore = threshold;
  for (let i = 0; i < scores.length; i++) {
    if (nonEmpty[i]! === 0) continue;
    const ratio = scores[i]! / nonEmpty[i]!;
    if (ratio > bestScore) {
      bestScore = ratio;
      best = i;
    }
  }
  return best === -1 ? null : best;
}

function argmax(vals: number[], threshold: number): number | null {
  let best = -1;
  let bestVal = threshold;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i]! > bestVal) {
      bestVal = vals[i]!;
      best = i;
    }
  }
  return best === -1 ? null : best;
}

function findByHeader(
  headerLc: string[],
  keywords: string[],
): number | null {
  for (let i = 0; i < headerLc.length; i++) {
    const h = headerLc[i]!;
    for (const k of keywords) {
      if (h === k || h.includes(k)) return i;
    }
  }
  return null;
}

/**
 * Infer date format from sample values. "YYYY-MM-DD" is detected first
 * (ISO is unambiguous). For slash/dash/dot-separated dates, checks whether
 * any value has a first or second part > 12 to disambiguate MM/DD vs DD/MM.
 * Default when ambiguous: MM/DD/YYYY (most common in US bank exports).
 */
export function detectDateFormat(samples: string[]): DateFormat {
  if (samples.length === 0) return "MM/DD/YYYY";
  if (samples.every((s) => /^\d{4}-/.test(s.trim()))) return "YYYY-MM-DD";

  let firstOver12 = false;
  let secondOver12 = false;
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) firstOver12 = true;
    if (b > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return "DD/MM/YYYY";
  return "MM/DD/YYYY"; // unambiguous or defaulted
}

/**
 * Infer number format from sample values. US vs EU differ by which
 * separator is the decimal:
 *   US: 1,234.56 (comma = thousands, dot = decimal)
 *   EU: 1.234,56 (dot = thousands, comma = decimal)
 * Heuristic: pick the separator that appears LAST in each value as the
 * decimal. Majority vote across samples.
 */
export function detectNumberFormat(samples: string[]): NumberFormat {
  let us = 0;
  let eu = 0;
  for (const raw of samples) {
    const s = raw.replace(/[^\d,.-]/g, "");
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot === -1 && lastComma === -1) continue;
    if (lastDot > lastComma) us += 1;
    else if (lastComma > lastDot) eu += 1;
  }
  return eu > us ? "EU" : "US";
}
