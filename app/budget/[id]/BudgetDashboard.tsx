"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { reportClientError } from "@/lib/client-logger";

interface Summary {
  budget: { id: string; name: string; type: string; archived_at: string | null };
  metrics: {
    total_spent: number;
    transaction_count: number;
    uncategorized_count: number;
    total_limit: number;
    remaining: number;
  };
  categories: Array<{
    id: string;
    name: string;
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

type DatePreset = "current_month" | "last_month" | "custom";

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
}: {
  budgetId: string;
  budgetName: string;
  budgetType: string;
  archived: boolean;
}) {
  const [range, setRange] = useState<DateRange | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addCatOpen, setAddCatOpen] = useState(false);

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

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8">
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
        <div className="flex gap-2">
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
            <MetricCards metrics={summary.metrics} />
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Categories</h2>
              <button
                type="button"
                onClick={() => setAddCatOpen(true)}
                disabled={archived}
                className="text-sm text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Add category
              </button>
            </div>
            {summary.categories.length > 0 ? (
              <CategoryGrid categories={summary.categories} />
            ) : (
              <EmptyState
                message="Add categories to organize your transactions and set spending limits."
                actionLabel="Add category"
                onAction={() => setAddCatOpen(true)}
                disabled={archived}
              />
            )}
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent transactions</h2>
              {summary.metrics.transaction_count > 0 && (
                <Link
                  href={`/budget/${budgetId}/transactions`}
                  className="text-sm text-[var(--color-primary)] hover:underline"
                >
                  View all →
                </Link>
              )}
            </div>
            {summary.recent_transactions.length > 0 ? (
              <RecentTransactions
                rows={summary.recent_transactions}
                categories={summary.categories}
              />
            ) : (
              <EmptyState
                message="No transactions in this date range. Upload a CSV to get started."
                actionLabel="Upload CSV"
                href={`/budget/${budgetId}/upload`}
                disabled={archived}
              />
            )}
          </section>

          <section className="mt-8">
            <UploadZone budgetId={budgetId} disabled={archived} />
          </section>
        </>
      )}

      {addCatOpen && (
        <AddCategoryForm
          budgetId={budgetId}
          onClose={() => setAddCatOpen(false)}
          onCreated={() => {
            setAddCatOpen(false);
            void fetchSummary();
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
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => onChange(currentMonthRange())}
        className={`rounded-lg px-3 py-1.5 ${
          range.preset === "current_month"
            ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
            : "border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
        }`}
      >
        Current month
      </button>
      <button
        type="button"
        onClick={() => onChange(lastMonthRange())}
        className={`rounded-lg px-3 py-1.5 ${
          range.preset === "last_month"
            ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
            : "border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
        }`}
      >
        Last month
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

function MetricCards({ metrics }: { metrics: Summary["metrics"] }) {
  const pctRemaining =
    metrics.total_limit > 0
      ? Math.max(0, Math.round((metrics.remaining / metrics.total_limit) * 100))
      : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <MetricCard
        label="Total spent"
        value={formatAmount(metrics.total_spent)}
        subtext={
          metrics.total_limit > 0
            ? `of ${formatAmount(metrics.total_limit)} limit`
            : "no limits set"
        }
      />
      <MetricCard
        label="Remaining"
        value={formatAmount(metrics.remaining)}
        subtext={pctRemaining !== null ? `${pctRemaining}% remaining` : "—"}
        valueClass={metrics.remaining < 0 ? "text-red-600" : undefined}
      />
      <MetricCard
        label="Transactions"
        value={String(metrics.transaction_count)}
        subtext="in date range"
      />
      <MetricCard
        label="Uncategorized"
        value={String(metrics.uncategorized_count)}
        subtext="needs attention"
        valueClass={metrics.uncategorized_count > 0 ? "text-yellow-600" : undefined}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  valueClass,
}: {
  label: string;
  value: string;
  subtext: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-[var(--color-muted)] p-4">
      <p className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{subtext}</p>
    </div>
  );
}

function CategoryGrid({
  categories,
}: {
  categories: Summary["categories"];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
      {categories.map((c) => (
        <CategoryCard key={c.id} category={c} />
      ))}
    </div>
  );
}

function CategoryCard({
  category,
}: {
  category: Summary["categories"][number];
}) {
  const pct =
    category.monthly_limit && category.monthly_limit > 0
      ? (category.spent / category.monthly_limit) * 100
      : null;
  const overBudget = pct !== null && pct > 100;
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-3">
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
    </div>
  );
}

function RecentTransactions({
  rows,
  categories,
}: {
  rows: Summary["recent_transactions"];
  categories: Summary["categories"];
}) {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  return (
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
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const amt = Number(t.amount);
              return (
                <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0">
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
                    {t.category_id ? (
                      <CategoryBadge cat={catMap.get(t.category_id)} />
                    ) : (
                      <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
                        Uncategorized
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: card list */}
      <div className="space-y-2 md:hidden">
        {rows.map((t) => {
          const amt = Number(t.amount);
          return (
            <div
              key={t.id}
              className="flex items-start justify-between rounded-lg border border-[var(--color-border)] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.description}</p>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{t.date}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`font-mono text-xs ${
                    amt < 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {amt < 0 ? "-" : "+"}{formatAmount(Math.abs(amt))}
                </span>
                {t.category_id ? (
                  <CategoryBadge cat={catMap.get(t.category_id)} />
                ) : (
                  <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
                    Uncategorized
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CategoryBadge({
  cat,
}: {
  cat: Summary["categories"][number] | undefined;
}) {
  if (!cat) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: cat.color }}
      />
      {cat.name}
    </span>
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
  onClose,
  onCreated,
}: {
  budgetId: string;
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
        <h2 className="text-lg font-semibold">Add category</h2>
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
