import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

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

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Welcome, {displayName}
          </p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-muted)]"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-8 rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Your budgets will appear here. Coming in Step 4.
        </p>
      </section>
    </main>
  );
}
