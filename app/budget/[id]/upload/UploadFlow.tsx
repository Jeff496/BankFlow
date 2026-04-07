"use client";

import { useEffect, useState } from "react";
import { parseCsvFile, type ParsedCsv } from "@/lib/csv/parse";
import { detectColumns, type ColumnDetection } from "@/lib/csv/detect";
import { transformRows, type TransformedRow, type ColumnMapping } from "@/lib/csv/transform";
import type { DateFormat, NumberFormat } from "@/lib/csv/format";
import { reportClientError } from "@/lib/client-logger";

type Stage = "select" | "map" | "preview" | "done";

type FieldRole = "date" | "description" | "amount" | "debit" | "credit" | "skip";

interface SavedMapping {
  id: string;
  bank_name: string;
  mapping: {
    date: string;
    description: string;
    amount?: string;
    debit?: string;
    credit?: string;
    date_format?: DateFormat;
    number_format?: NumberFormat;
  };
}

interface ImportResult {
  uploadId: string | null;
  inserted: number;
  skipped: number;
  autoCategorized: number;
}

export function UploadFlow({
  budgetId,
  disabled,
}: {
  budgetId: string;
  disabled: boolean;
}) {
  const [stage, setStage] = useState<Stage>("select");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [detection, setDetection] = useState<ColumnDetection | null>(null);
  const [roles, setRoles] = useState<FieldRole[]>([]);
  const [dateFormat, setDateFormat] = useState<DateFormat>("MM/DD/YYYY");
  const [numberFormat, setNumberFormat] = useState<NumberFormat>("US");
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>([]);
  const [appliedMapping, setAppliedMapping] = useState<SavedMapping | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [transformed, setTransformed] = useState<TransformedRow[]>([]);
  const [transformErrors, setTransformErrors] = useState<{ rowIndex: number; reason: string }[]>([]);
  const [duplicateHashes, setDuplicateHashes] = useState<Set<string>>(new Set());
  const [skipHashes, setSkipHashes] = useState<Set<string>>(new Set());
  const [bankNameToSave, setBankNameToSave] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  // Load saved mappings once
  useEffect(() => {
    let cancelled = false;
    fetch("/api/mappings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed to load mappings"))))
      .then((data) => {
        if (!cancelled) setSavedMappings(data.mappings ?? []);
      })
      .catch((err) => reportClientError(err, { scope: "upload.load_mappings" }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFilePicked(f: File) {
    setFile(f);
    setTopError(null);
    try {
      const p = await parseCsvFile(f);
      if (p.rowCount === 0) throw new Error("CSV has no data rows");
      setParsed(p);
      const det = detectColumns(p.headers, p.rows);
      setDetection(det);

      // Try to apply a saved mapping that matches these headers
      const match = findMatchingSavedMapping(savedMappings, p.headers);
      if (match) {
        applySavedMapping(match, p.headers);
      } else {
        applyDetection(det, p.headers.length);
      }
      setStage("map");
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "failed to parse CSV");
      reportClientError(err, { scope: "upload.parse" });
    }
  }

  function applyDetection(det: ColumnDetection, colCount: number) {
    const r: FieldRole[] = new Array(colCount).fill("skip");
    if (det.dateIdx !== null) r[det.dateIdx] = "date";
    if (det.descriptionIdx !== null) r[det.descriptionIdx] = "description";
    if (det.amountIdx !== null) r[det.amountIdx] = "amount";
    if (det.debitIdx !== null) r[det.debitIdx] = "debit";
    if (det.creditIdx !== null) r[det.creditIdx] = "credit";
    setRoles(r);
    setDateFormat(det.dateFormat);
    setNumberFormat(det.numberFormat);
    setAppliedMapping(null);
  }

  function applySavedMapping(m: SavedMapping, headers: string[]) {
    const r: FieldRole[] = new Array(headers.length).fill("skip");
    const setRole = (colName: string | undefined, role: FieldRole) => {
      if (!colName) return;
      const idx = headers.findIndex((h) => h === colName);
      if (idx !== -1) r[idx] = role;
    };
    setRole(m.mapping.date, "date");
    setRole(m.mapping.description, "description");
    setRole(m.mapping.amount, "amount");
    setRole(m.mapping.debit, "debit");
    setRole(m.mapping.credit, "credit");
    setRoles(r);
    setDateFormat(m.mapping.date_format ?? "MM/DD/YYYY");
    setNumberFormat(m.mapping.number_format ?? "US");
    setAppliedMapping(m);
  }

  function resetToDetection() {
    if (!detection || !parsed) return;
    applyDetection(detection, parsed.headers.length);
  }

  async function confirmMapping() {
    if (!parsed) return;
    setMappingError(null);

    const mapping: ColumnMapping = {
      dateIdx: roles.indexOf("date"),
      descriptionIdx: roles.indexOf("description"),
      amountIdx: roles.indexOf("amount") === -1 ? null : roles.indexOf("amount"),
      debitIdx: roles.indexOf("debit") === -1 ? null : roles.indexOf("debit"),
      creditIdx: roles.indexOf("credit") === -1 ? null : roles.indexOf("credit"),
      dateFormat,
      numberFormat,
    };

    if (mapping.dateIdx === -1) {
      setMappingError("Select a date column.");
      return;
    }
    if (mapping.descriptionIdx === -1) {
      setMappingError("Select a description column.");
      return;
    }
    if (mapping.amountIdx === null && (mapping.debitIdx === null || mapping.creditIdx === null)) {
      setMappingError("Select either an amount column OR both debit and credit columns.");
      return;
    }

    const { rows: transformedRows, errors } = await transformRows(parsed.rows, mapping);
    setTransformed(transformedRows);
    setTransformErrors(errors);

    if (transformedRows.length === 0) {
      setMappingError(
        `No rows could be parsed. First error: ${errors[0]?.reason ?? "unknown"}`,
      );
      return;
    }

    // Ask the server which hashes already exist for this budget
    try {
      const res = await fetch("/api/uploads/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          budget_id: budgetId,
          hashes: transformedRows.map((r) => r.hash),
        }),
      });
      if (!res.ok) throw new Error("duplicate check failed");
      const data = await res.json();
      const dups = new Set<string>(data.duplicate_hashes ?? []);
      setDuplicateHashes(dups);
      setSkipHashes(new Set(dups)); // by default, skip duplicates
    } catch (err) {
      reportClientError(err, { scope: "upload.dupe_check" });
      setDuplicateHashes(new Set());
      setSkipHashes(new Set());
    }

    setStage("preview");
  }

  async function confirmImport() {
    if (!file || transformed.length === 0) return;
    setImporting(true);
    setTopError(null);
    try {
      const toSend = transformed.filter((r) => !skipHashes.has(r.hash));
      if (toSend.length === 0) {
        setTopError("All rows are marked as skipped. Nothing to import.");
        setImporting(false);
        return;
      }

      const res = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          budget_id: budgetId,
          filename: file.name,
          transactions: toSend,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setImportResult({
        uploadId: data.upload?.id ?? null,
        inserted: data.inserted_count ?? 0,
        skipped: data.skipped_duplicates ?? 0,
        autoCategorized: data.auto_categorized_count ?? 0,
      });

      // Save mapping if user asked
      if (bankNameToSave.trim() && parsed) {
        const mapping = buildSaveMapping(parsed.headers, roles, dateFormat, numberFormat);
        await fetch("/api/mappings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bank_name: bankNameToSave.trim(), mapping }),
        }).catch((err) => reportClientError(err, { scope: "upload.save_mapping" }));
      }

      setStage("done");
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "import failed");
      reportClientError(err, { scope: "upload.confirm" });
    } finally {
      setImporting(false);
    }
  }

  function resetAll() {
    setStage("select");
    setFile(null);
    setParsed(null);
    setDetection(null);
    setRoles([]);
    setTransformed([]);
    setTransformErrors([]);
    setDuplicateHashes(new Set());
    setSkipHashes(new Set());
    setBankNameToSave("");
    setImportResult(null);
    setTopError(null);
    setMappingError(null);
    setAppliedMapping(null);
  }

  if (disabled) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Uploads are disabled for archived budgets.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {topError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          {topError}
        </div>
      )}

      <ol className="flex gap-3 text-sm">
        {(["select", "map", "preview", "done"] as Stage[]).map((s, i) => (
          <li
            key={s}
            className={`rounded-md px-3 py-1 ${
              s === stage
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
            }`}
          >
            {i + 1}. {stageLabel(s)}
          </li>
        ))}
      </ol>

      {stage === "select" && <FilePicker onFile={handleFilePicked} />}

      {stage === "map" && parsed && detection && (
        <MapperStep
          parsed={parsed}
          roles={roles}
          setRoles={setRoles}
          dateFormat={dateFormat}
          setDateFormat={setDateFormat}
          numberFormat={numberFormat}
          setNumberFormat={setNumberFormat}
          detection={detection}
          appliedMapping={appliedMapping}
          onReset={resetToDetection}
          onNext={confirmMapping}
          onBack={resetAll}
          mappingError={mappingError}
          bankNameToSave={bankNameToSave}
          setBankNameToSave={setBankNameToSave}
        />
      )}

      {stage === "preview" && (
        <PreviewStep
          transformed={transformed}
          duplicateHashes={duplicateHashes}
          skipHashes={skipHashes}
          setSkipHashes={setSkipHashes}
          transformErrors={transformErrors}
          importing={importing}
          onBack={() => setStage("map")}
          onConfirm={confirmImport}
        />
      )}

      {stage === "done" && importResult && (
        <DoneStep result={importResult} onAnother={resetAll} budgetId={budgetId} />
      )}
    </div>
  );
}

// ---------- sub-components ----------

function FilePicker({ onFile }: { onFile: (f: File) => void }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`block cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
        dragOver
          ? "border-[var(--color-primary)] bg-[var(--color-muted)]"
          : "border-[var(--color-border)]"
      }`}
    >
      <p className="text-sm font-medium">Drop a CSV file here or click to browse</p>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
        Supports most bank CSV formats (US + EU)
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function MapperStep({
  parsed,
  roles,
  setRoles,
  dateFormat,
  setDateFormat,
  numberFormat,
  setNumberFormat,
  detection,
  appliedMapping,
  onReset,
  onNext,
  onBack,
  mappingError,
  bankNameToSave,
  setBankNameToSave,
}: {
  parsed: ParsedCsv;
  roles: FieldRole[];
  setRoles: (r: FieldRole[]) => void;
  dateFormat: DateFormat;
  setDateFormat: (f: DateFormat) => void;
  numberFormat: NumberFormat;
  setNumberFormat: (f: NumberFormat) => void;
  detection: ColumnDetection;
  appliedMapping: SavedMapping | null;
  onReset: () => void;
  onNext: () => void;
  onBack: () => void;
  mappingError: string | null;
  bankNameToSave: string;
  setBankNameToSave: (s: string) => void;
}) {
  const sampleRows = parsed.rows.slice(0, 5);
  return (
    <div className="space-y-4">
      {appliedMapping && (
        <div className="flex items-center justify-between rounded-md bg-[var(--color-muted)] px-3 py-2 text-sm">
          <span>
            Using saved mapping: <strong>{appliedMapping.bank_name}</strong>
          </span>
          <button
            type="button"
            onClick={onReset}
            className="text-[var(--color-primary)] hover:underline"
          >
            Reset
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-muted)]">
              {parsed.headers.map((h, idx) => (
                <th key={idx} className="border-b border-[var(--color-border)] p-2 align-top">
                  <div className="space-y-1">
                    <div className="font-semibold">{h || `col ${idx + 1}`}</div>
                    <select
                      value={roles[idx] ?? "skip"}
                      onChange={(e) => {
                        const next = [...roles];
                        next[idx] = e.target.value as FieldRole;
                        setRoles(next);
                      }}
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1 py-0.5 text-xs"
                    >
                      <option value="skip">(skip)</option>
                      <option value="date">Date</option>
                      <option value="description">Description</option>
                      <option value="amount">Amount</option>
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                    {isAutoDetected(idx, detection, appliedMapping) && (
                      <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-900 dark:bg-green-900/30 dark:text-green-200">
                        Auto-detected
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, r) => (
              <tr key={r} className="border-b border-[var(--color-border)] last:border-0">
                {row.map((cell, c) => (
                  <td key={c} className="p-2 text-xs font-mono">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          Date format
          <select
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as DateFormat)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
          >
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Number format
          <select
            value={numberFormat}
            onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
          >
            <option value="US">US (1,234.56)</option>
            <option value="EU">EU (1.234,56)</option>
          </select>
        </label>
      </div>

      <div>
        <label className="text-sm font-medium">
          Save this mapping as…
          <input
            type="text"
            placeholder="e.g. Chase checking"
            value={bankNameToSave}
            onChange={(e) => setBankNameToSave(e.target.value)}
            className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
          />
        </label>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          Optional. Next time you upload a file with the same column headers, this mapping is applied automatically.
        </p>
      </div>

      {mappingError && (
        <p className="text-sm text-[var(--color-destructive,#dc2626)]">{mappingError}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function PreviewStep({
  transformed,
  duplicateHashes,
  skipHashes,
  setSkipHashes,
  transformErrors,
  importing,
  onBack,
  onConfirm,
}: {
  transformed: TransformedRow[];
  duplicateHashes: Set<string>;
  skipHashes: Set<string>;
  setSkipHashes: (s: Set<string>) => void;
  transformErrors: { rowIndex: number; reason: string }[];
  importing: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const keepCount = transformed.length - skipHashes.size;
  const dupCount = duplicateHashes.size;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          <strong>{transformed.length}</strong> parsed
        </span>
        <span className="text-[var(--color-muted-foreground)]">·</span>
        <span>
          <strong>{dupCount}</strong> duplicates
        </span>
        <span className="text-[var(--color-muted-foreground)]">·</span>
        <span>
          <strong>{keepCount}</strong> will import
        </span>
        {transformErrors.length > 0 && (
          <>
            <span className="text-[var(--color-muted-foreground)]">·</span>
            <span className="text-yellow-700 dark:text-yellow-300">
              <strong>{transformErrors.length}</strong> rows skipped (parse errors)
            </span>
          </>
        )}
      </div>

      <div className="max-h-96 overflow-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--color-muted)]">
            <tr>
              <th className="p-2 text-left">Include</th>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {transformed.map((row) => {
              const isDup = duplicateHashes.has(row.hash);
              const skipped = skipHashes.has(row.hash);
              return (
                <tr
                  key={row.hash}
                  className={`border-b border-[var(--color-border)] last:border-0 ${
                    skipped ? "opacity-50" : ""
                  }`}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={!skipped}
                      onChange={() => {
                        const next = new Set(skipHashes);
                        if (skipped) next.delete(row.hash);
                        else next.add(row.hash);
                        setSkipHashes(next);
                      }}
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{row.date}</td>
                  <td className="p-2">{row.description}</td>
                  <td
                    className={`p-2 text-right font-mono text-xs ${
                      row.amount < 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {row.amount.toFixed(2)}
                  </td>
                  <td className="p-2">
                    {isDup && (
                      <span className="inline-block rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200">
                        Duplicate
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={importing}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={importing || keepCount === 0}
          className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {importing ? "Importing…" : `Import ${keepCount} transaction${keepCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  result,
  onAnother,
  budgetId,
}: {
  result: ImportResult;
  onAnother: () => void;
  budgetId: string;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-6">
      <div className="text-center">
        <p className="text-2xl font-bold">Import complete</p>
        <p className="mt-1 text-sm">
          {result.inserted} transaction{result.inserted === 1 ? "" : "s"} imported
          {result.autoCategorized > 0 && (
            <> ({result.autoCategorized} auto-categorized)</>
          )}
          {result.skipped > 0 && `, ${result.skipped} skipped as duplicates`}.
        </p>
      </div>

      <div className="flex justify-center gap-2">
        <a
          href={`/budget/${budgetId}`}
          className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
        >
          View budget
        </a>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)]"
        >
          Upload another
        </button>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function stageLabel(s: Stage): string {
  switch (s) {
    case "select":
      return "Pick file";
    case "map":
      return "Map columns";
    case "preview":
      return "Preview";
    case "done":
      return "Done";
  }
}

function isAutoDetected(
  colIdx: number,
  det: ColumnDetection,
  applied: SavedMapping | null,
): boolean {
  if (applied) return false; // saved-mapping banner already indicates origin
  return (
    det.dateIdx === colIdx ||
    det.descriptionIdx === colIdx ||
    det.amountIdx === colIdx ||
    det.debitIdx === colIdx ||
    det.creditIdx === colIdx
  );
}

function findMatchingSavedMapping(
  mappings: SavedMapping[],
  headers: string[],
): SavedMapping | null {
  const headerSet = new Set(headers);
  for (const m of mappings) {
    const required = [m.mapping.date, m.mapping.description];
    if (m.mapping.amount) required.push(m.mapping.amount);
    if (m.mapping.debit) required.push(m.mapping.debit);
    if (m.mapping.credit) required.push(m.mapping.credit);
    if (required.every((name) => headerSet.has(name))) return m;
  }
  return null;
}

function buildSaveMapping(
  headers: string[],
  roles: FieldRole[],
  dateFormat: DateFormat,
  numberFormat: NumberFormat,
): Record<string, unknown> {
  const mapping: Record<string, unknown> = {
    date_format: dateFormat,
    number_format: numberFormat,
  };
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    if (role && role !== "skip") mapping[role] = headers[i];
  }
  return mapping;
}

