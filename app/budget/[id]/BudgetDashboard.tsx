"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { reportClientError } from "@/lib/client-logger";

interface Summary {
  budget: {
    id: string;
    name: string;
    type: string;
    archived_at: string | null;
    sheet_id: string | null;
    sheet_last_synced_at: string | null;
  };
  metrics: {
    total_spent: number;
    total_income: number;
    transaction_count: number;
    uncategorized_count: number;
    excluded_count: number;
    total_limit: number;
    remaining: number;
  };
  categories: Array<{
    id: string;
    name: string;
    type: string;
    color: string;
    monthly_limit: number | null;
    spent: number;
    transaction_count: number;
  }>;
  recent_transactions: Array<{
    id: string;
    date: string;
    description: string;
    amount: number | string;
    category_id: string | null;
    uploaded_by: string;
  }>;
}

type DatePreset = "current_month" | "last_month" | "all_time" | "custom";

interface DateRange {
  start: string;
  end: string;
  preset: DatePreset;
}

export function BudgetDashboard({
  budgetId,
  budgetName,
  budgetType,
  archived,
  currentUserId,
}: {
  budgetId: string;
  budgetName: string;
  budgetType: string;
  archived: boolean;
  currentUserId: string;
}) {
  const [range, setRange] = useState<DateRange | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [addCatType, setAddCatType] = useState<"expense" | "income">("expense");
  const [editCat, setEditCat] = useState<Summary["categories"][number] | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [txRefresh, setTxRefresh] = useState(0);
  const [recategorizing, setRecategorizing] = useState(false);
  const [recatResult, setRecatResult] = useState<string | null>(null);

  // Set default range (current month in browser TZ) once on mount
  useEffect(() => {
    setRange(currentMonthRange());
  }, []);

  const fetchSummary = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/budgets/${budgetId}/summary?start_date=${range.start}&end_date=${range.end}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      setSummary(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load");
      reportClientError(err, { scope: "dashboard.summary" });
    } finally {
      setLoading(false);
    }
  }, [budgetId, range]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  async function archiveBudget() {
    if (!confirm("Archive this budget? You can still view it but writes will be blocked.")) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/budgets/${budgetId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "archive failed");
      reportClientError(err, { scope: "budget.archive" });
    } finally {
      setArchiving(false);
    }
  }

  async function deleteCategory(catId: string) {
    if (!confirm("Delete this category? Transactions will become uncategorized.")) return;
    try {
      const res = await fetch(`/api/categories/${catId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      void fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function recategorize() {
    setRecategorizing(true);
    setRecatResult(null);
    try {
      const res = await fetch("/api/transactions/recategorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget_id: budgetId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecatResult(
        data.recategorized_count > 0
          ? `${data.recategorized_count} transaction${data.recategorized_count === 1 ? "" : "s"} categorized`
          : "No matches found",
      );
      void fetchSummary();
      setTxRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "recategorize failed");
      reportClientError(err, { scope: "recategorize" });
    } finally {
      setRecategorizing(false);
    }
  }

  async function deleteTransaction(txId: string) {
    if (!confirm("Delete this transaction?")) return;
    try {
      const res = await fetch(`/api/transactions/${txId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      void fetchSummary();
      setTxRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground,#000)]"
      >
        ← Dashboard
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">{budgetName}</h1>
            <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--color-muted-foreground)]">
              {budgetType}
            </span>
            {archived && (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200">
                Archived
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncButton
            budgetId={budgetId}
            sheetId={summary?.budget.sheet_id ?? null}
            lastSyncedAt={summary?.budget.sheet_last_synced_at ?? null}
            archived={archived}
            onSynced={() => void fetchSummary()}
          />
          <Link
            href={`/budget/${budgetId}/upload`}
            className={`rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 ${
              archived ? "pointer-events-none opacity-50" : ""
            }`}
          >
            Upload CSV
          </Link>
        </div>
      </header>

      <div className="mt-6">
        <DateFilter range={range} onChange={setRange} />
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {loading && !summary && (
        <div className="mt-6 text-sm text-[var(--color-muted-foreground)]">Loading…</div>
      )}

      {summary && (
        <>
          <section className="mt-6">
            <MetricCards
              metrics={summary.metrics}
              categories={summary.categories}
              selectedCatIds={selectedCatIds}
              showUncategorized={showUncategorized}
              onToggleUncategorized={() => {
                setShowUncategorized((prev) => !prev);
                setSelectedCatIds(new Set());
              }}
              onRecategorize={recategorize}
              recategorizing={recategorizing}
              recatResult={recatResult}
              archived={archived}
            />
          </section>

          {/* Spending categories */}
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Spending</h2>
              <button
                type="button"
                onClick={() => { setAddCatType("expense"); setAddCatOpen(true); }}
                disabled={archived}
                className="text-sm text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Add category
              </button>
            </div>
            {summary.categories.filter((c) => c.type !== "income").length > 0 ? (
              <CategoryGrid
                categories={summary.categories.filter((c) => c.type !== "income")}
                selectedIds={selectedCatIds}
                onToggle={(id) => {
                  setShowUncategorized(false);
                  setSelectedCatIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                onEdit={(c) => setEditCat(c)}
                onDelete={archived ? undefined : deleteCategory}
              />
            ) : (
              <EmptyState
                message="Add categories to organize your transactions and set spending limits."
                actionLabel="Add category"
                onAction={() => { setAddCatType("expense"); setAddCatOpen(true); }}
                disabled={archived}
              />
            )}
          </section>

          {/* Income categories */}
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Income</h2>
              <button
                type="button"
                onClick={() => { setAddCatType("income"); setAddCatOpen(true); }}
                disabled={archived}
                className="text-sm text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Add category
              </button>
            </div>
            {summary.categories.filter((c) => c.type === "income").length > 0 ? (
              <CategoryGrid
                categories={summary.categories.filter((c) => c.type === "income")}
                selectedIds={selectedCatIds}
                onToggle={(id) => {
                  setShowUncategorized(false);
                  setSelectedCatIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                onEdit={(c) => setEditCat(c)}
                onDelete={archived ? undefined : deleteCategory}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
                Income categories are created automatically when you upload transactions with positive amounts.
              </p>
            )}
          </section>

          <TransactionSection
            budgetId={budgetId}
            range={range}
            selectedCatIds={selectedCatIds}
            showUncategorized={showUncategorized}
            categories={summary.categories}
            archived={archived}
            refreshKey={txRefresh}
            onClearFilter={() => { setSelectedCatIds(new Set()); setShowUncategorized(false); }}
            onDelete={deleteTransaction}
          />

          <section className="mt-8">
            <UploadZone budgetId={budgetId} disabled={archived} />
          </section>

          {budgetType === "group" && (
            <MembersSection
              budgetId={budgetId}
              currentUserId={currentUserId}
              archived={archived}
            />
          )}

          {!archived && (
            <section className="mt-12 rounded-xl border border-red-200 p-4 dark:border-red-900">
              <h2 className="text-sm font-semibold text-red-600">Danger zone</h2>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                Archiving hides the budget from your dashboard. Data is preserved.
              </p>
              <button
                type="button"
                onClick={archiveBudget}
                disabled={archiving}
                className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900/20"
              >
                {archiving ? "Archiving…" : "Archive budget"}
              </button>
            </section>
          )}
        </>
      )}

      {addCatOpen && (
        <AddCategoryForm
          budgetId={budgetId}
          categoryType={addCatType}
          onClose={() => setAddCatOpen(false)}
          onCreated={() => {
            setAddCatOpen(false);
            void fetchSummary();
          }}
        />
      )}

      {editCat && (
        <EditCategoryForm
          category={editCat}
          onClose={() => setEditCat(null)}
          onSaved={() => {
            setEditCat(null);
            void fetchSummary();
          }}
          onDeleted={() => {
            setEditCat(null);
            void deleteCategory(editCat.id);
          }}
        />
      )}
    </main>
  );
}

// ---------- sub-components ----------

function DateFilter({
  range,
  onChange,
}: {
  range: DateRange | null;
  onChange: (r: DateRange) => void;
}) {
  if (!range) return null;
  const presetClass = (p: DatePreset) =>
    `rounded-lg px-3 py-1.5 ${
      range.preset === p
        ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
        : "border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => onChange(currentMonthRange())} className={presetClass("current_month")}>
        Current month
      </button>
      <button type="button" onClick={() => onChange(lastMonthRange())} className={presetClass("last_month")}>
        Last month
      </button>
      <button type="button" onClick={() => onChange(allTimeRange())} className={presetClass("all_time")}>
        All time
      </button>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-2 py-1">
        <input
          type="date"
          value={range.start}
          max={range.end}
          onChange={(e) =>
            onChange({ ...range, start: e.target.value, preset: "custom" })
          }
          className="bg-transparent text-sm outline-none"
        />
        <span className="text-[var(--color-muted-foreground)]">→</span>
        <input
          type="date"
          value={range.end}
          min={range.start}
          onChange={(e) =>
            onChange({ ...range, end: e.target.value, preset: "custom" })
          }
          className="bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
}

function MetricCards({
  metrics,
  categories,
  selectedCatIds,
  showUncategorized,
  onToggleUncategorized,
  onRecategorize,
  recategorizing,
  recatResult,
  archived,
}: {
  metrics: Summary["metrics"];
  categories: Summary["categories"];
  selectedCatIds: Set<string>;
  showUncategorized: boolean;
  onToggleUncategorized: () => void;
  onRecategorize: () => void;
  recategorizing: boolean;
  recatResult: string | null;
  archived: boolean;
}) {
  // When categories are selected, compute filtered metrics from per-category data
  const filtered = selectedCatIds.size > 0;
  const selectedCats = filtered
    ? categories.filter((c) => selectedCatIds.has(c.id))
    : [];

  const totalSpent = filtered
    ? selectedCats.filter((c) => c.type !== "income").reduce((sum, c) => sum + c.spent, 0)
    : metrics.total_spent;
  const totalIncome = filtered
    ? selectedCats.filter((c) => c.type === "income").reduce((sum, c) => sum + c.spent, 0)
    : metrics.total_income;
  const totalLimit = filtered
    ? selectedCats.filter((c) => c.type !== "income").reduce((sum, c) => sum + (c.monthly_limit ?? 0), 0)
    : metrics.total_limit;
  const remaining = totalLimit - totalSpent;
  const txCount = filtered
    ? selectedCats.reduce((sum, c) => sum + c.transaction_count, 0)
    : metrics.transaction_count;

  const pctRemaining =
    totalLimit > 0
      ? Math.max(0, Math.round((remaining / totalLimit) * 100))
      : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <MetricCard
        label="Spending"
        value={formatAmount(totalSpent)}
        subtext={
          totalLimit > 0
            ? `of ${formatAmount(totalLimit)} limit`
            : "no limits set"
        }
      />
      <MetricCard
        label="Income"
        value={formatAmount(totalIncome)}
        subtext="in date range"
        valueClass={totalIncome > 0 ? "text-green-600" : undefined}
      />
      <MetricCard
        label="Remaining"
        value={formatAmount(remaining)}
        subtext={pctRemaining !== null ? `${pctRemaining}% remaining` : "—"}
        valueClass={remaining < 0 ? "text-red-600" : undefined}
      />
      <MetricCard
        label="Transactions"
        value={String(txCount)}
        subtext={filtered ? "in selected categories" : "in date range"}
      />
      {filtered ? (
        <MetricCard
          label="Categories"
          value={String(selectedCatIds.size)}
          subtext={`of ${categories.length} selected`}
        />
      ) : (
        <div className="space-y-2">
          <MetricCard
            label="Uncategorized"
            value={String(metrics.uncategorized_count)}
            subtext={showUncategorized ? "filtered" : "needs attention"}
            valueClass={metrics.uncategorized_count > 0 ? "text-yellow-600" : undefined}
            onClick={metrics.uncategorized_count > 0 ? onToggleUncategorized : undefined}
            selected={showUncategorized}
          />
          {metrics.uncategorized_count > 0 && !archived && (
            <button
              type="button"
              onClick={onRecategorize}
              disabled={recategorizing}
              className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              {recategorizing ? "Categorizing..." : "Auto-categorize"}
            </button>
          )}
          {recatResult && (
            <p className="text-center text-xs text-[var(--color-muted-foreground)]">{recatResult}</p>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  valueClass,
  onClick,
  selected,
}: {
  label: string;
  value: string;
  subtext: string;
  valueClass?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${
        selected
          ? "border-2 border-[var(--color-primary)] bg-[var(--color-muted)]"
          : "bg-[var(--color-muted)]"
      } ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
      onClick={onClick}
    >
      <p className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{subtext}</p>
    </div>
  );
}

function CategoryGrid({
  categories,
  selectedIds,
  onToggle,
  onEdit,
  onDelete,
}: {
  categories: Summary["categories"];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (c: Summary["categories"][number]) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
      {categories.map((c) => (
        <CategoryCard
          key={c.id}
          category={c}
          selected={selectedIds.has(c.id)}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function CategoryCard({
  category,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  category: Summary["categories"][number];
  selected: boolean;
  onToggle: (id: string) => void;
  onEdit: (c: Summary["categories"][number]) => void;
  onDelete?: (id: string) => void;
}) {
  const pct =
    category.monthly_limit && category.monthly_limit > 0
      ? (category.spent / category.monthly_limit) * 100
      : null;
  const overBudget = pct !== null && pct > 100;

  return (
    <div
      className={`cursor-pointer rounded-xl border-2 p-3 transition-colors hover:bg-[var(--color-muted)] ${
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-muted)]"
          : "border-[var(--color-border)]"
      }`}
      onClick={() => onToggle(category.id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: category.color }}
          />
          <span className="truncate text-sm font-medium">{category.name}</span>
        </div>
        <span
          className={`text-sm font-mono ${
            overBudget ? "text-red-600" : ""
          }`}
        >
          {formatAmount(category.spent)}
        </span>
      </div>
      {pct !== null ? (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted)]">
            <div
              className={`h-full transition-all ${
                overBudget ? "bg-red-600" : "bg-[var(--color-primary)]"
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-[var(--color-muted-foreground)]">
            <span>{formatAmount(category.monthly_limit ?? 0)} limit</span>
            <span>
              {overBudget ? "Over budget" : `${Math.max(0, Math.round(100 - pct))}% left`}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">No limit set</p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(category);
          }}
          className="text-xs text-[var(--color-primary)] hover:underline"
        >
          Edit
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(category.id);
            }}
            className="text-xs text-red-600 hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface TxRow {
  id: string;
  date: string;
  description: string;
  amount: number | string;
  category_id: string | null;
  excluded: boolean;
}

const TX_PAGE_SIZE = 50;

function TransactionSection({
  budgetId,
  range,
  selectedCatIds,
  showUncategorized,
  categories,
  archived,
  refreshKey,
  onClearFilter,
  onDelete,
}: {
  budgetId: string;
  range: DateRange | null;
  selectedCatIds: Set<string>;
  showUncategorized: boolean;
  categories: Summary["categories"];
  archived: boolean;
  refreshKey: number;
  onClearFilter: () => void;
  onDelete: (id: string) => void;
}) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const catMap = new Map(categories.map((c) => [c.id, c]));

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
    } catch {
      // ignore — errors shown elsewhere
    } finally {
      setBusyId(null);
    }
  }

  async function toggleExcluded(txId: string, excluded: boolean) {
    setBusyId(txId);
    try {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excluded }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((prev) =>
        prev.map((r) => (r.id === txId ? { ...r, excluded } : r)),
      );
    } catch {
      // ignore
    } finally {
      setBusyId(null);
    }
  }

  const fetchPage = useCallback(
    async (cursorVal: string | null, append: boolean) => {
      if (!range) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          budget_id: budgetId,
          limit: String(TX_PAGE_SIZE),
          start_date: range.start,
          end_date: range.end,
        });
        if (cursorVal) params.set("cursor", cursorVal);
        if (showUncategorized) {
          params.set("uncategorized", "true");
        } else if (selectedCatIds.size === 1) {
          // If exactly one category selected, use server-side filter
          params.set("category_id", [...selectedCatIds][0]);
        }
        const res = await fetch(`/api/transactions?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setRows((prev) => (append ? [...prev, ...data.transactions] : data.transactions));
        setCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      } catch {
        // ignore — errors shown elsewhere
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgetId, range, selectedCatIds, showUncategorized, refreshKey],
  );

  useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  // For multi-category filter, filter client-side
  const filtered =
    selectedCatIds.size > 1
      ? rows.filter((t) => t.category_id !== null && selectedCatIds.has(t.category_id))
      : rows;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {showUncategorized ? "Uncategorized transactions" : selectedCatIds.size > 0 ? "Filtered transactions" : "Transactions"}
        </h2>
        {(selectedCatIds.size > 0 || showUncategorized) && (
          <button
            type="button"
            onClick={onClearFilter}
            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {filtered.length === 0 && !loading ? (
        selectedCatIds.size > 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
            No transactions match the selected categories in this date range.
          </p>
        ) : (
          <EmptyState
            message="No transactions in this date range. Upload a CSV to get started."
            actionLabel="Upload CSV"
            href={`/budget/${budgetId}/upload`}
            disabled={archived}
          />
        )
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-muted)]">
                <tr>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Description</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2 text-left">Category</th>
                  {!archived && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const amt = Number(t.amount);
                  return (
                    <tr key={t.id} className={`border-b border-[var(--color-border)] last:border-0 ${t.excluded ? "opacity-40" : ""}`}>
                      <td className="p-2 font-mono text-xs">{t.date}</td>
                      <td className="p-2">{t.description}</td>
                      <td
                        className={`p-2 text-right font-mono text-xs ${
                          amt < 0 ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {amt < 0 ? "-" : "+"}{formatAmount(Math.abs(amt))}
                      </td>
                      <td className="p-2">
                        {editingId === t.id ? (
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
                            onClick={() => !archived && setEditingId(t.id)}
                            className={`rounded-full px-2 py-0.5 text-xs ${!archived ? "hover:ring-1 hover:ring-[var(--color-border)]" : ""}`}
                            style={
                              t.category_id && catMap.get(t.category_id)
                                ? { backgroundColor: `${catMap.get(t.category_id)!.color}22`, color: catMap.get(t.category_id)!.color }
                                : undefined
                            }
                            disabled={archived}
                          >
                            {t.category_id && catMap.get(t.category_id) ? catMap.get(t.category_id)!.name : "Uncategorized"}
                          </button>
                        )}
                      </td>
                      {!archived && (
                        <td className="p-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleExcluded(t.id, !t.excluded)}
                            disabled={busyId === t.id}
                            className="text-xs text-[var(--color-muted-foreground)] hover:underline disabled:opacity-50"
                          >
                            {t.excluded ? "Include" : "Exclude"}
                          </button>
                          <span className="mx-1 text-[var(--color-border)]">|</span>
                          <button
                            type="button"
                            onClick={() => onDelete(t.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <div className="space-y-2 md:hidden">
            {filtered.map((t) => {
              const amt = Number(t.amount);
              return (
                <div
                  key={t.id}
                  className={`flex items-start justify-between rounded-lg border border-[var(--color-border)] p-3 ${t.excluded ? "opacity-40" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.description}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{t.date}</p>
                    {!archived && (
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExcluded(t.id, !t.excluded)}
                          disabled={busyId === t.id}
                          className="text-xs text-[var(--color-muted-foreground)] hover:underline disabled:opacity-50"
                        >
                          {t.excluded ? "Include" : "Exclude"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(t.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`font-mono text-xs ${
                        amt < 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {amt < 0 ? "-" : "+"}{formatAmount(Math.abs(amt))}
                    </span>
                    {editingId === t.id ? (
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
                        onClick={() => !archived && setEditingId(t.id)}
                        className={`rounded-full px-2 py-0.5 text-xs ${!archived ? "hover:ring-1 hover:ring-[var(--color-border)]" : ""}`}
                        style={
                          t.category_id && catMap.get(t.category_id)
                            ? { backgroundColor: `${catMap.get(t.category_id)!.color}22`, color: catMap.get(t.category_id)!.color }
                            : undefined
                        }
                        disabled={archived}
                      >
                        {t.category_id && catMap.get(t.category_id) ? catMap.get(t.category_id)!.name : "Uncategorized"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void fetchPage(cursor, true)}
                disabled={loading}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {loading && rows.length === 0 && (
            <p className="mt-4 text-center text-sm text-[var(--color-muted-foreground)]">Loading…</p>
          )}
        </>
      )}
    </section>
  );
}


function EmptyState({
  message,
  actionLabel,
  onAction,
  href,
  disabled,
}: {
  message: string;
  actionLabel: string;
  onAction?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center">
      <p className="text-sm text-[var(--color-muted-foreground)]">{message}</p>
      <div className="mt-3">
        {href ? (
          <Link
            href={href}
            className={`inline-block rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 ${
              disabled ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {actionLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function UploadZone({
  budgetId,
  disabled,
}: {
  budgetId: string;
  disabled: boolean;
}) {
  if (disabled) return null;
  return (
    <Link
      href={`/budget/${budgetId}/upload`}
      className="block rounded-2xl border-2 border-dashed border-[var(--color-border)] p-6 text-center transition-colors hover:bg-[var(--color-muted)]"
    >
      <p className="text-sm font-medium">Drop a CSV file here or click to browse</p>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
        Supports most bank CSV formats
      </p>
    </Link>
  );
}

function AddCategoryForm({
  budgetId,
  categoryType,
  onClose,
  onCreated,
}: {
  budgetId: string;
  categoryType: "expense" | "income";
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        budget_id: budgetId,
        name: name.trim(),
        type: categoryType,
        color,
      };
      if (monthlyLimit) body.monthly_limit = Number(monthlyLimit);
      if (keywords.trim()) {
        body.keywords = keywords
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
      }
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error?.message ?? `HTTP ${res.status}`);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create");
    } finally {
      setSaving(false);
    }
  }

  const swatches = [
    "#ef4444", "#f97316", "#eab308", "#22c55e",
    "#06b6d4", "#3b82f6", "#a855f7", "#ec4899",
    "#6b7280",
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[var(--color-background)] p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">Add {categoryType} category</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Groceries"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
          <div>
            <p className="text-sm">Color</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {swatches.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`color ${c}`}
                  className={`h-7 w-7 rounded-full ${
                    color === c ? "ring-2 ring-offset-2 ring-[var(--color-primary)]" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <label className="block text-sm">
            Monthly limit (optional)
            <input
              type="number"
              min="0"
              step="0.01"
              value={monthlyLimit}
              onChange={(e) => setMonthlyLimit(e.target.value)}
              placeholder="500"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Keywords (comma-separated)
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="trader joe, whole foods"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- sheets sync ----------

function SyncButton({
  budgetId,
  sheetId,
  lastSyncedAt,
  archived,
  onSynced,
}: {
  budgetId: string;
  sheetId: string | null;
  lastSyncedAt: string | null;
  archived: boolean;
  onSynced: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sheets/sync/${budgetId}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = body.error?.code;
        if (code === "GOOGLE_REAUTH_REQUIRED") {
          setError("Google access expired — sign out and back in to refresh.");
        } else if (code === "CONFLICT") {
          setError("Another sync is running. Wait a moment and retry.");
        } else {
          setError(body.error?.message ?? `Sync failed (${res.status})`);
        }
        return;
      }
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sync failed");
      reportClientError(err, { scope: "sheets.sync" });
    } finally {
      setBusy(false);
    }
  }

  const label = sheetId ? "Sync to Sheets" : "Create Google Sheet";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {sheetId && (
          <a
            href={`https://docs.google.com/spreadsheets/d/${sheetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--color-primary)] hover:underline"
          >
            Open in Sheets ↗
          </a>
        )}
        <button
          type="button"
          onClick={sync}
          disabled={busy || archived}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Syncing…" : label}
        </button>
      </div>
      {lastSyncedAt && !error && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          synced {relativeTime(lastSyncedAt)}
        </p>
      )}
      {error && (
        <p className="max-w-xs text-right text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

// ---------- members (group budgets) ----------

interface Member {
  id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
  users: { id: string; email: string; display_name: string | null } | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: "editor" | "viewer";
  expires_at: string;
  status: string;
}

function MembersSection({
  budgetId,
  currentUserId,
  archived,
}: {
  budgetId: string;
  currentUserId: string;
  archived: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mRes, iRes] = await Promise.all([
        fetch(`/api/budgets/${budgetId}/members`),
        fetch(`/api/invitations`), // only shows invites addressed to me
      ]);
      if (mRes.ok) setMembers((await mRes.json()).members ?? []);
      // Pending invites view: fetched separately below via direct query is
      // not possible (RLS hides invitations not addressed to the caller OR
      // not owned by the caller). Owner can see invites they sent via the
      // same /api/invitations endpoint with a different filter — but our
      // current endpoint is "pending for me". So we skip listing sent
      // invites here for MVP.
      void iRes; // silence unused
      setPendingInvites([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load members");
      reportClientError(err, { scope: "members.load" });
    }
  }, [budgetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myRole = members.find((m) => m.user_id === currentUserId)?.role ?? null;
  const isOwner = myRole === "owner";

  async function removeMember(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(
        `/api/budgets/${budgetId}/members/${userId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "remove failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Members</h2>
        {isOwner && !archived && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="text-sm text-[var(--color-primary)] hover:underline"
          >
            + Invite
          </button>
        )}
      </div>
      {error && (
        <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {members.map((m) => {
          const isMe = m.user_id === currentUserId;
          const canRemove =
            !archived &&
            ((isOwner && !isMe) || // owner can kick others
              (isMe && m.role !== "owner")); // anyone can leave (but not owners)
          return (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-xl border border-[var(--color-border)] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {m.users?.display_name ?? m.users?.email ?? m.user_id}
                  {isMe && (
                    <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">
                      (you)
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {m.users?.email}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    m.role === "owner"
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                  }`}
                >
                  {m.role}
                </span>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => removeMember(m.user_id)}
                    disabled={busyId === m.user_id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    {isMe ? "Leave" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {pendingInvites.length > 0 && <span />}
      </div>

      {inviteOpen && (
        <InviteMemberForm
          budgetId={budgetId}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInviteOpen(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

function InviteMemberForm({
  budgetId,
  onClose,
  onInvited,
}: {
  budgetId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/budgets/${budgetId}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error?.message ?? `HTTP ${res.status}`);
      }
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to invite");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[var(--color-background)] p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">Invite member</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            >
              <option value="editor">Editor (can upload + edit)</option>
              <option value="viewer">Viewer (read-only)</option>
            </select>
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !email.trim()}
            className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Sending…" : "Send invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- edit category ----------

function EditCategoryForm({
  category,
  onClose,
  onSaved,
  onDeleted,
}: {
  category: Summary["categories"][number];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [monthlyLimit, setMonthlyLimit] = useState(
    category.monthly_limit !== null ? String(category.monthly_limit) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim(), color };
      body.monthly_limit = monthlyLimit ? Number(monthlyLimit) : null;
      const res = await fetch(`/api/categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error?.message ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const swatches = [
    "#ef4444", "#f97316", "#eab308", "#22c55e",
    "#06b6d4", "#3b82f6", "#a855f7", "#ec4899",
    "#6b7280",
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[var(--color-background)] p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">Edit category</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
          <div>
            <p className="text-sm">Color</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {swatches.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`color ${c}`}
                  className={`h-7 w-7 rounded-full ${
                    color === c ? "ring-2 ring-offset-2 ring-[var(--color-primary)]" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <label className="block text-sm">
            Monthly limit
            <input
              type="number"
              min="0"
              step="0.01"
              value={monthlyLimit}
              onChange={(e) => setMonthlyLimit(e.target.value)}
              placeholder="No limit"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onDeleted}
            className="text-sm text-red-600 hover:underline"
          >
            Delete category
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function formatAmount(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toFixed(2)}`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function currentMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: ymd(start), end: ymd(end), preset: "current_month" };
}

function lastMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: ymd(start), end: ymd(end), preset: "last_month" };
}

function allTimeRange(): DateRange {
  return { start: "2000-01-01", end: ymd(new Date()), preset: "all_time" };
}
