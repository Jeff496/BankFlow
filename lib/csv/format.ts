export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
export type NumberFormat = "US" | "EU";

/**
 * Parse a bank-provided date string into ISO `YYYY-MM-DD` using the caller-
 * confirmed format. Throws on unparseable input.
 *
 * Accepts /, -, or . as separators for MM/DD/YYYY and DD/MM/YYYY forms.
 * Two-digit years are treated as 2000+year (bank CSVs from the 1900s are
 * out of scope).
 */
export function parseDate(raw: string, format: DateFormat): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty date");

  if (format === "YYYY-MM-DD") {
    const m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) throw new Error(`can't parse "${raw}" as YYYY-MM-DD`);
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  }

  const m = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) throw new Error(`can't parse "${raw}" as ${format}`);
  const a = m[1]!;
  const b = m[2]!;
  const yearRaw = m[3]!;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

  const [month, day] = format === "MM/DD/YYYY" ? [a, b] : [b, a];
  const mm = Number(month);
  const dd = Number(day);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    throw new Error(`invalid month/day in "${raw}"`);
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(s: string): string {
  return s.padStart(2, "0");
}

/**
 * Parse a bank-provided number in US (`1,234.56`) or EU (`1.234,56`) format.
 * Strips currency symbols, whitespace, and parentheses. Parentheses are
 * treated as a negative-number indicator (common in accounting exports).
 */
export function parseNumber(raw: string, format: NumberFormat): number {
  let s = raw.trim();
  if (!s) throw new Error("empty number");

  // Accounting-style parens → negative
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Strip currency symbols, spaces, and anything non-numeric except , . - +
  s = s.replace(/[^\d,.\-+]/g, "");

  if (format === "EU") {
    // 1.234,56 → 1234.56
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // 1,234.56 → 1234.56
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`can't parse "${raw}" as number`);
  return negative ? -Math.abs(n) : n;
}
