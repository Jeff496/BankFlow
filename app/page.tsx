import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="max-w-xl space-y-4 text-center">
        <h1 className="text-5xl font-bold tracking-tight">BankFlow</h1>
        <p className="text-lg text-[var(--color-muted-foreground)]">
          Personal and group budget tracking. Upload bank CSVs, categorize
          transactions, sync to Google Sheets.
        </p>
      </div>
      <Link
        href="/login"
        className="rounded-lg bg-[var(--color-primary)] px-6 py-2.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        Sign in with Google
      </Link>
    </main>
  );
}
