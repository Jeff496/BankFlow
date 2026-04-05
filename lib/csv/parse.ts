import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  rowCount: number;
}

/**
 * Parse a CSV File into string-typed header row + data rows. We intentionally
 * DO NOT use PapaParse's `dynamicTyping` or `header: true` so that:
 *   - we see the raw bank-provided header labels (for column mapping)
 *   - number/date parsing happens explicitly afterwards with known formats
 *   - empty cells stay as empty strings instead of mysterious undefineds
 */
export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: "greedy",
      complete(results) {
        if (results.errors.length > 0) {
          // PapaParse also reports row-level warnings (e.g. FieldMismatch)
          // through results.errors, so only reject on fatal ones.
          const fatal = results.errors.find(
            (e) => e.type !== "FieldMismatch" && e.type !== "Quotes",
          );
          if (fatal) {
            reject(new Error(`CSV parse failed: ${fatal.message}`));
            return;
          }
        }
        const all = results.data;
        if (all.length === 0) {
          reject(new Error("CSV is empty"));
          return;
        }
        const [headers, ...rows] = all;
        resolve({
          headers: headers.map((h) => h.trim()),
          rows,
          rowCount: rows.length,
        });
      },
      error(err) {
        reject(err);
      },
    });
  });
}
