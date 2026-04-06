import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploadFlow } from "./UploadFlow";

export default async function UploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS filters to budgets the user is a member of — non-member → null → 404.
  const { data: budget } = await supabase
    .from("budgets")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (!budget) notFound();

  const archived = budget.archived_at !== null;

  return (
    <main className="mx-auto max-w-5xl p-6 sm:p-8">
      <Link
        href={`/budget/${budget.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground,#000)]"
      >
        ← {budget.name}
      </Link>
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Upload CSV</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          to <span className="font-medium">{budget.name}</span>
        </p>
        {archived && (
          <p className="mt-3 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200">
            This budget is archived. You can view uploads but new writes are blocked.
          </p>
        )}
      </header>
      <UploadFlow budgetId={budget.id} disabled={archived} />
    </main>
  );
}
