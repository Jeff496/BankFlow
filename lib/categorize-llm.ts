import Anthropic from "@anthropic-ai/sdk";
import { log } from "@/lib/logger";

export interface LLMCategorizationResult {
  /** description → existing category_id */
  assignments: Map<string, string>;
  /** description → suggested new category name */
  newCategories: Map<string, string>;
}

interface CategoryInfo {
  id: string;
  name: string;
  type?: string; // 'expense' | 'income'
}

const BATCH_SIZE = 100;

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function buildPrompt(
  descriptions: string[],
  categories: CategoryInfo[],
  transactionType: "expense" | "income" = "expense",
): string {
  const catList =
    categories.length > 0
      ? categories.map((c) => `  "${c.id}": "${c.name}"`).join("\n")
      : "  (none)";

  const typeHint = transactionType === "income"
    ? "\nThese are INCOME transactions (deposits, refunds, payments received). Suggest income-appropriate category names (e.g. \"Salary\", \"Freelance\", \"Refunds\", \"Interest\", \"Transfers In\")."
    : "\nThese are EXPENSE transactions (purchases, payments, withdrawals). Suggest expense-appropriate category names (e.g. \"Groceries\", \"Gas\", \"Subscriptions\", \"Dining\").";

  return `You are a bank transaction categorizer. You will be given a list of raw bank transaction descriptions and a list of existing budget categories.
${typeHint}

For each transaction description, do ONE of the following:
1. If an existing category fits, assign it by returning the category id.
2. If no existing category fits but you can identify what the transaction is for, suggest a short new category name. Use common, concise budget category names. Consolidate similar transactions under the same new category name.
3. If the transaction is truly ambiguous or unidentifiable (e.g. generic "ACH Withdrawal"), return null.

Existing categories:
${catList}

Transaction descriptions (JSON array):
${JSON.stringify(descriptions)}

Respond with a JSON object with exactly two keys:
- "assign": an object mapping each description string to an existing category id (string) or null
- "create": an object mapping each description string to a suggested new category name (string)

Every description must appear in exactly one of the two objects. Descriptions assigned null in "assign" and not in "create" are left uncategorized.`;
}

async function callLLM(
  descriptions: string[],
  categories: CategoryInfo[],
  transactionType: "expense" | "income" = "expense",
): Promise<{ assign: Record<string, string | null>; create: Record<string, string> }> {
  const client = getClient();
  if (!client) throw new Error("no_api_key");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: buildPrompt(descriptions, categories, transactionType),
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  // Extract JSON from the response (may be wrapped in ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("llm_no_json");

  return JSON.parse(jsonMatch[0]);
}

/**
 * Categorizes a batch of unique transaction descriptions using Claude Haiku.
 * Assigns to existing categories or suggests new category names.
 *
 * Returns an empty result (no assignments, no new categories) if:
 * - ANTHROPIC_API_KEY is not configured
 * - The API call fails
 * - The response cannot be parsed
 */
export async function categorizeBatchWithLLM(
  descriptions: string[],
  categories: CategoryInfo[],
  transactionType: "expense" | "income" = "expense",
): Promise<LLMCategorizationResult> {
  const empty: LLMCategorizationResult = {
    assignments: new Map(),
    newCategories: new Map(),
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    log().warn({ event: "llm.categorize.skip", reason: "no_api_key" });
    return empty;
  }

  if (descriptions.length === 0) return empty;

  const validIds = new Set(categories.map((c) => c.id));
  const result: LLMCategorizationResult = {
    assignments: new Map(),
    newCategories: new Map(),
  };

  // Process in batches
  for (let i = 0; i < descriptions.length; i += BATCH_SIZE) {
    const batch = descriptions.slice(i, i + BATCH_SIZE);

    try {
      const llmResult = await callLLM(batch, categories, transactionType);

      // Process assignments to existing categories
      if (llmResult.assign) {
        for (const [desc, catId] of Object.entries(llmResult.assign)) {
          if (catId && validIds.has(catId)) {
            result.assignments.set(desc, catId);
          }
        }
      }

      // Process new category suggestions
      if (llmResult.create) {
        for (const [desc, catName] of Object.entries(llmResult.create)) {
          if (catName && typeof catName === "string" && catName.trim()) {
            result.newCategories.set(desc, catName.trim());
          }
        }
      }
    } catch (err) {
      log().error({
        event: "llm.categorize.error",
        batchStart: i,
        batchSize: batch.length,
        reason: err instanceof Error ? err.message : "unknown",
      });
      // Continue with next batch — partial results are better than none
    }
  }

  log().info({
    event: "llm.categorize.done",
    totalDescriptions: descriptions.length,
    assigned: result.assignments.size,
    newCategorySuggestions: result.newCategories.size,
  });

  return result;
}
