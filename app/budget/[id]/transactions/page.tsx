import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TransactionsList } from "./TransactionsList";

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: budget } = await supabase
    .from("budgets")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!budget) notFound();

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, color")
    .eq("budget_id", id)
    .order("created_at", { ascending: true });

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8">
      <Link
        href={`/budget/${budget.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground,#000)]"
      >
        ← {budget.name}
      </Link>
      <h1 className="mb-6 text-2xl font-bold">Transactions</h1>
      <TransactionsList
        budgetId={budget.id}
        categories={categories ?? []}
      />
    </main>
  );
}
