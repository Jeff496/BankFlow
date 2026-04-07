import Anthropic from "@anthropic-ai/sdk";
import { log } from "@/lib/logger";

/** description → existing category_id */
export type LLMAssignments = Map<string, string>;

interface CategoryInfo {
  id: string;
  name: string;
}

const BATCH_SIZE = 30;

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
): string {
  const catList = categories.map((c) => `  "${c.id}": "${c.name}"`).join("\n");

  return `You are a bank transaction categorizer. You will be given a list of raw bank transaction descriptions and a list of existing budget categories.

For each transaction description, assign it to the BEST matching existing category by returning the category id. If NO existing category is a reasonable fit, return null — do NOT force a bad match.

Existing categories:
${catList}

Transaction descriptions (JSON array):
${JSON.stringify(descriptions)}

Respond with a JSON object mapping each description string to an existing category id (string) or null.
Example: {"AMAZON.COM*AB1CD2EF3": "uuid-here", "ACH WITHDRAWAL": null}`;
}

async function callLLM(
  descriptions: string[],
  categories: CategoryInfo[],
): Promise<Record<string, string | null>> {
  const client = getClient();
  if (!client) throw new Error("no_api_key");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: buildPrompt(descriptions, categories),
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("llm_no_json");

  return JSON.parse(jsonMatch[0]);
}

/**
 * Categorizes a batch of unique transaction descriptions using Claude Haiku.
 * Assigns only to existing categories — never suggests new ones.
 *
 * Returns an empty map if ANTHROPIC_API_KEY is not set or the API fails.
 */
export async function categorizeBatchWithLLM(
  descriptions: string[],
  categories: CategoryInfo[],
): Promise<LLMAssignments> {
  if (!process.env.ANTHROPIC_API_KEY) {
    log().warn({ event: "llm.categorize.skip", reason: "no_api_key" });
    return new Map();
  }

  if (descriptions.length === 0 || categories.length === 0) return new Map();

  const validIds = new Set(categories.map((c) => c.id));
  const result: LLMAssignments = new Map();

  for (let i = 0; i < descriptions.length; i += BATCH_SIZE) {
    const batch = descriptions.slice(i, i + BATCH_SIZE);

    try {
      const llmResult = await callLLM(batch, categories);

      for (const [desc, catId] of Object.entries(llmResult)) {
        if (catId && validIds.has(catId)) {
          result.set(desc, catId);
        }
      }
    } catch (err) {
      log().error({
        event: "llm.categorize.error",
        batchStart: i,
        batchSize: batch.length,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  log().info({
    event: "llm.categorize.done",
    totalDescriptions: descriptions.length,
    assigned: result.size,
  });

  return result;
}
