import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { InvitationsList } from "./InvitationsList";
import { CreateBudgetButton } from "./CreateBudget";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Profile row is created by the handle_new_user trigger at signup.
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const displayName =
    profile?.display_name ?? user.email?.split("@")[0] ?? "there";

  // RLS filters to owned + member budgets.
  const { data: budgets } = await supabase
    .from("budgets")
    .select("id, name, type, archived_at")
    .order("created_at", { ascending: false });

  const personal = (budgets ?? []).filter((b) => b.type === "personal" && !b.archived_at);
  const group = (budgets ?? []).filter((b) => b.type === "group" && !b.archived_at);
  const archived = (budgets ?? []).filter((b) => b.archived_at !== null);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Welcome, {displayName}
          </p>
        </div>
        <div className="flex gap-2">
          <CreateBudgetButton />
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-muted)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <InvitationsList />

      <BudgetSection title="Personal" budgets={personal} />
      {group.length > 0 && <BudgetSection title="Group" budgets={group} />}
      {archived.length > 0 && (
        <BudgetSection title="Archived" budgets={archived} archived />
      )}

      {personal.length === 0 && group.length === 0 && (
        <section className="mt-8 rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No budgets yet. Create your first budget to start tracking spending.
          </p>
          <div className="mt-3">
            <CreateBudgetButton />
          </div>
        </section>
      )}
    </main>
  );
}

function BudgetSection({
  title,
  budgets,
  archived,
}: {
  title: string;
  budgets: { id: string; name: string }[];
  archived?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {budgets.map((b) => (
          <Link
            key={b.id}
            href={`/budget/${b.id}`}
            className={`rounded-xl border border-[var(--color-border)] p-4 hover:bg-[var(--color-muted)] ${
              archived ? "opacity-60" : ""
            }`}
          >
            <p className="font-medium">{b.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
