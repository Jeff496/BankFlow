"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reportClientError } from "@/lib/client-logger";

export function CreateBudgetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        + New budget
      </button>
      {open && (
        <CreateBudgetForm onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CreateBudgetForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"personal" | "group">("personal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error?.message ?? `HTTP ${res.status}`);
      }
      const { budget } = await res.json();
      onClose();
      startTransition(() => router.push(`/budget/${budget.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create");
      reportClientError(err, { scope: "budget.create" });
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
        <h2 className="text-lg font-semibold">New budget</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Monthly Budget"
              autoFocus
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
          </label>
          <fieldset>
            <legend className="text-sm">Type</legend>
            <div className="mt-1 flex gap-2">
              {(["personal", "group"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize ${
                    type === t
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
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
            onClick={create}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create budget"}
          </button>
        </div>
      </div>
    </div>
  );
}
