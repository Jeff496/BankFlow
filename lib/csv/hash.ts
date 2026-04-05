/**
 * SHA-256(date + "|" + amount.toFixed(2) + "|" + description) → lowercase hex.
 * Used for client-side dedup of transactions: identical rows (to 2 decimal
 * places on amount) will have identical hashes even if CSV formatting
 * differs slightly.
 */
export async function hashTransaction(
  date: string,
  amount: number,
  description: string,
): Promise<string> {
  const normalized = `${date}|${amount.toFixed(2)}|${description.trim()}`;
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
