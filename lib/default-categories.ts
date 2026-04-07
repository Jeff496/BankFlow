/**
 * Default categories seeded when a budget is created.
 * Users can add more manually; the LLM only assigns to existing categories.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Housing", color: "#3b82f6", keywords: ["rent", "mortgage", "hoa"] },
  { name: "Groceries / Takeout", color: "#22c55e", keywords: ["grocery", "groceries", "trader joe", "whole foods", "costco", "walmart", "target", "doordash", "uber eats", "grubhub", "taco bell", "mcdonald", "chipotle", "starbucks"] },
  { name: "Bills", color: "#f97316", keywords: ["electric", "water", "gas bill", "utility", "phone bill", "internet"] },
  { name: "Subscriptions", color: "#a855f7", keywords: ["netflix", "spotify", "hulu", "disney+", "apple.com/bill", "amazon prime", "youtube"] },
  { name: "Online Shopping", color: "#ec4899", keywords: ["amazon", "ebay", "etsy", "shopify"] },
  { name: "Transportation", color: "#06b6d4", keywords: ["uber", "lyft", "gas", "shell", "chevron", "exxon", "parking", "transit"] },
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  { name: "Income", color: "#22c55e", keywords: ["payroll", "salary", "direct deposit", "paycheck"] },
  { name: "Refunds", color: "#06b6d4", keywords: ["refund", "return", "credit"] },
] as const;
