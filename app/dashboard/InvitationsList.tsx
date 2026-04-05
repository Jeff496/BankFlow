"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reportClientError } from "@/lib/client-logger";

interface Invitation {
  invitation_id: string;
  budget_id: string;
  budget_name: string;
  budget_type: "personal" | "group";
  invited_by: string;
  inviter_name: string | null;
  role: "editor" | "viewer";
  expires_at: string;
  created_at: string;
}

export function InvitationsList() {
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invitations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvites(data.invitations ?? []);
    } catch (err) {
      reportClientError(err, { scope: "dashboard.invitations" });
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(inv: Invitation, status: "accepted" | "declined") {
    setBusyId(inv.invitation_id);
    setError(null);
    try {
      const res = await fetch(`/api/invitations/${inv.invitation_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      await load();
      // Refresh server-rendered budgets list (an accept added a new one).
      if (status === "accepted") startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
      reportClientError(err, { scope: "dashboard.invitations.act", status });
    } finally {
      setBusyId(null);
    }
  }

  if (invites === null) return null; // initial load, render nothing
  if (invites.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Pending invitations
      </h2>
      {error && (
        <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {invites.map((inv) => (
          <div
            key={inv.invitation_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <strong>{inv.inviter_name ?? "Someone"}</strong> invited you to{" "}
                <strong>{inv.budget_name}</strong>{" "}
                <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {inv.role}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                expires {new Date(inv.expires_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => act(inv, "declined")}
                disabled={busyId === inv.invitation_id}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-muted)] disabled:opacity-50"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => act(inv, "accepted")}
                disabled={busyId === inv.invitation_id}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
              >
                Accept
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
