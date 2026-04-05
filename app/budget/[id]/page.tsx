import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BudgetDashboard } from "./BudgetDashboard";

export default async function BudgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: budget } = await supabase
    .from("budgets")
    .select("id, name, type, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (!budget) notFound();

  return (
    <BudgetDashboard
      budgetId={budget.id}
      budgetName={budget.name}
      budgetType={budget.type}
      archived={budget.archived_at !== null}
      currentUserId={user.id}
    />
  );
}
