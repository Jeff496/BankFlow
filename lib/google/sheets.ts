import { googleJson, type GoogleTokens } from "./fetch";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const TAB_TRANSACTIONS = "Transactions";
export const TAB_SUMMARY = "Budget Summary";
export const TAB_SETTINGS = "Settings";

interface CreateSpreadsheetResponse {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties: { title: string };
  sheets: Array<{ properties: { sheetId: number; title: string } }>;
}

/**
 * Creates a new spreadsheet with our three tabs in one request, so we don't
 * have to follow up with a batchUpdate to rename/add sheets.
 */
export async function createSpreadsheet(
  tokens: GoogleTokens,
  title: string,
): Promise<CreateSpreadsheetResponse> {
  return googleJson<CreateSpreadsheetResponse>(
    BASE,
    tokens,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          { properties: { title: TAB_TRANSACTIONS } },
          { properties: { title: TAB_SUMMARY } },
          { properties: { title: TAB_SETTINGS } },
        ],
      }),
    },
    "sheets.create",
  );
}

interface GetSpreadsheetResponse {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties: { title: string };
  sheets: Array<{ properties: { sheetId: number; title: string } }>;
}

export async function getSpreadsheet(
  tokens: GoogleTokens,
  spreadsheetId: string,
): Promise<GetSpreadsheetResponse> {
  // fields mask keeps the response small — we only need titles/ids
  const url = `${BASE}/${encodeURIComponent(
    spreadsheetId,
  )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`;
  return googleJson<GetSpreadsheetResponse>(url, tokens, {}, "sheets.get");
}

/**
 * Clear the given ranges, then write new values to them. Uses
 * values:batchClear followed by values:batchUpdate — simpler than
 * spreadsheets:batchUpdate with updateCells requests and avoids
 * sheetId-tracking overhead.
 */
export async function writeTabs(
  tokens: GoogleTokens,
  spreadsheetId: string,
  tabs: Array<{ title: string; values: (string | number | null)[][] }>,
): Promise<void> {
  // 1. Clear every data range — column A through ZZ for safety. A well-known
  //    range is required (not just the sheet name) for batchClear.
  await googleJson(
    `${BASE}/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    tokens,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ranges: tabs.map((t) => `'${t.title}'!A1:ZZ100000`),
      }),
    },
    "sheets.clear",
  );

  // 2. Write new values. USER_ENTERED interprets dates/numbers naturally.
  await googleJson(
    `${BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    tokens,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: tabs.map((t) => ({
          range: `'${t.title}'!A1`,
          values: t.values,
        })),
      }),
    },
    "sheets.write",
  );
}
