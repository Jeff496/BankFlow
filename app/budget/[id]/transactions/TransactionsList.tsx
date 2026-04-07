"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { reportClientError } from "@/lib/client-logger";

interface Category {
  id: string;
  name: string;
  color: string;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number | string;
  category_id: string | null;
  uploaded_by: string;
}

const PAGE_SIZE = 50;

export function TransactionsList({
  budgetId,
  categories,
}: {
  budgetId: string;
  categories: Category[];
}) {
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncategorized, setUncategorized] = useState(false);
  const [filterCat, setFilterCat] = useState(searchParams.get("category_id") ?? "");
  const [startDate, setStartDate] = useState(searchParams.get("start_date") ?? "");
  const [endDate, setEndDate] = useState(searchParams.get("end_date") ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const fetchPage = useCallback(
    async (cursorVal: string | null, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ budget_id: budgetId, limit: String(PAGE_SIZE) });
        if (cursorVal) params.set("cursor", cursorVal);
        if (uncategorized) params.set("uncategorized", "true");
        else if (filterCat) params.set("category_id", filterCat);
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);

        const res = await fetch(`/api/transactions?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRows((prev) => (append ? [...prev, ...data.transactions] : data.transactions));
        setCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to load");
        reportClientError(err, { scope: "transactions.list" });
      } finally {
        setLoading(false);
      }
    },
    [budgetId, uncategorized, filterCat, startDate, endDate],
  );

  useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  async function deleteRow(id: string) {
    if (!confirm("Delete this transaction?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function updateCategory(txId: string, categoryId: string | null) {
    setBusyId(txId);
    try {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_id: categoryId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((prev) =>
        prev.map((r) => (r.id === txId ? { ...r, category_id: categoryId } : r)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={uncategorized}
            onChange={(e) => {
              setUncategorized(e.target.checked);
              if (e.target.checked) setFilterCat("");
            }}
          />
          Uncategorized only
        </label>
        <select
          value={filterCat}
          onChange={(e) => {
            setFilterCat(e.target.value);
            if (e.target.value) setUncategorized(false);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
          placeholder="Start date"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
          placeholder="End date"
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-muted)]">
            <tr>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2 text-left">Category</th>
              <th className="p-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const amt = Number(t.amount);
              const cat = t.category_id ? catMap.get(t.category_id) : null;
              const isEditing = editingId === t.id;
              return (
                <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="p-2 font-mono text-xs">{t.date}</td>
                  <td className="p-2">{t.description}</td>
                  <td className={`p-2 text-right font-mono text-xs ${amt < 0 ? "text-red-600" : "text-green-600"}`}>
                    {amt < 0 ? "-" : "+"}${Math.abs(amt).toFixed(2)}
                  </td>
                  <td className="p-2">
                    {isEditing ? (
                      <select
                        autoFocus
                        value={t.category_id ?? ""}
                        onChange={(e) => updateCategory(t.id, e.target.value || null)}
                        onBlur={() => setEditingId(null)}
                        disabled={busyId === t.id}
                        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1 py-0.5 text-xs"
                      >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingId(t.id)}
                        className="rounded-full px-2 py-0.5 text-xs hover:ring-1 hover:ring-[var(--color-border)]"
                        style={
                          cat
                            ? { backgroundColor: `${cat.color}22`, color: cat.color }
                            : undefined
                        }
                      >
                        {cat ? cat.name : "Uncategorized"}
                      </button>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      onClick={() => deleteRow(t.id)}
                      disabled={busyId === t.id}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  No transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-muted-foreground)]">
          {rows.length} transaction{rows.length === 1 ? "" : "s"} shown
        </span>
        {hasMore && (
          <button
            type="button"
            onClick={() => void fetchPage(cursor, true)}
            disabled={loading}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
