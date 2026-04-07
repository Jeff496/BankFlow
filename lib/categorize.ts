export interface CategoryRule {
  id: string;
  keywords: string[]; // lowercased
}

/**
 * First-match-wins keyword categorizer. Categories are expected to be
 * pre-sorted by creation date ASC so older categories take precedence over
 * newer ones when keywords overlap (per mvp.md §Step 6 verification).
 *
 * Matching is case-insensitive substring — a transaction description
 * containing any keyword from a category (anywhere in the string) is
 * assigned that category. Empty keyword strings are ignored.
 */
export function categorize(
  description: string,
  categories: CategoryRule[],
): string | null {
  const haystack = description.toLowerCase();
  for (const cat of categories) {
    for (const kw of cat.keywords) {
      if (kw && haystack.includes(kw)) {
        return cat.id;
      }
    }
  }
  return null;
}

/**
 * Prepares category rules for the categorizer: lowercases and trims each
 * keyword once so categorize() doesn't have to on every transaction.
 * Filters out empty keywords entirely.
 */
export function prepareRules<T extends { id: string; keywords: string[] }>(
  categories: T[],
): CategoryRule[] {
  return categories.map((c) => ({
    id: c.id,
    keywords: c.keywords
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0),
  }));
}

// ---------------------------------------------------------------------------
// Tier 2: History-based categorization
// ---------------------------------------------------------------------------

/**
 * Strips bank-specific noise from a transaction description to extract
 * a stable merchant identity suitable for history matching.
 */
export function normalizeDescription(description: string): string {
  let s = description;

  // Lowercase first so all regex can be case-insensitive-free
  s = s.toLowerCase();

  // Strip common bank prefixes (Wells Fargo, Chase, etc.)
  s = s.replace(
    /^(purchase|recurring payment|money transfer) authorized on \d{2}\/\d{2}\s*/,
    "",
  );
  s = s.replace(/^(purchase return) authorized on \d{2}\/\d{2}\s*/, "");
  s = s.replace(/^ach (withdrawal|deposit|returned to)\s*/i, "");
  s = s.replace(/^(transfer (from|to))\s*/i, "");

  // Wells Fargo auth code + card suffix: S/P + 15 digits ... CARD XXXX
  s = s.replace(/\s*[sp]\d{15}\s*card\s*\d+$/i, "");

  // PayPal-wrapped merchants: extract the real merchant name
  // "PAYPAL *TACO BELL 402-..." → "taco bell 402-..."
  s = s.replace(/^paypal\s*\*/, "");

  // Strip phone numbers (XXX-XXX-XXXX)
  s = s.replace(/\d{3}-\d{3}-\d{4}/g, "");

  // Strip store/branch numbers (#1234, D742016)
  s = s.replace(/#\d+/g, "");
  s = s.replace(/\b[a-z]?\d{5,}\b/g, "");

  // Strip Zelle reference tails: ON MM/DD REF # XXXXX ...
  s = s.replace(/\s+on\s+\d{2}\/\d{2}\s+ref\s+#\s*\S+.*$/, "");

  // Strip online transfer tails: XXXXXX1234 REF #... ON MM/DD/YY
  s = s.replace(/\s+x{3,}\d+.*$/, "");

  // Strip 2-letter US state codes at end (preceded by space + city-like word)
  s = s.replace(/\s+[a-z]{2}$/, "");

  // Strip trailing single letters/digits (common Zelle memo artifacts)
  s = s.replace(/\s+[a-z0-9]$/, "");

  // Collapse whitespace and trim
  s = s.replace(/[,]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

export type HistoryMap = Map<string, Map<string, number>>;

/**
 * Pre-computes a lookup map: normalizedDescription → { categoryId → count }.
 * Built once per upload so each transaction lookup is O(1).
 */
export function buildHistoryMap(
  history: Array<{ description: string; category_id: string }>,
): HistoryMap {
  const map: HistoryMap = new Map();
  for (const row of history) {
    const key = normalizeDescription(row.description);
    if (!key) continue;
    let inner = map.get(key);
    if (!inner) {
      inner = new Map();
      map.set(key, inner);
    }
    inner.set(row.category_id, (inner.get(row.category_id) ?? 0) + 1);
  }
  return map;
}

/**
 * Looks up a transaction description in the history map. Returns the
 * majority-vote category_id if confidence > 50%, otherwise null.
 */
export function categorizeFromHistory(
  description: string,
  historyMap: HistoryMap,
): string | null {
  const key = normalizeDescription(description);
  const counts = historyMap.get(key);
  if (!counts) return null;

  let bestId: string | null = null;
  let bestCount = 0;
  let total = 0;

  for (const [catId, count] of counts) {
    total += count;
    if (count > bestCount) {
      bestCount = count;
      bestId = catId;
    }
  }

  // Require > 50% agreement
  if (bestId && bestCount / total > 0.5) return bestId;
  return null;
}
