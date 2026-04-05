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
