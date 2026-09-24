import { useMemo } from "react";
import { activeBudgets, budgetCategoryIds, formatMinor, getRow, save, type Budget } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { CategoryIcon } from "@/components/ui";
import { ReorderList } from "@/components/ReorderList";
import { budgetTitle, nameMaps } from "@/lib/budgetName";
import { getBudgetScope } from "@/lib/settings";
import { scopeAccount } from "@/lib/scope";
import { todayLocal } from "@/lib/dates";

/** Drag the budgets into the order you want them on the Budgets screen. The drag is `ReorderList`. */
export default function BudgetReorder() {
  const budgets = useQuery((d) => {
    const names = nameMaps(d);
    return activeBudgets(d, todayLocal(), scopeAccount(getBudgetScope())).map((b) => ({ b, title: budgetTitle(b, names), icon: iconOf(b, d) }));
  });
  const items = useMemo(() => budgets.map(({ b, title, icon }) => ({
    id: b.id, title,
    subtitle: `${formatMinor(b.amount_minor, b.currency)} ${b.currency}${b.in_planned === 0 ? " · not in Planned" : ""}`,
    icon: <CategoryIcon name={title} icon={icon?.icon ?? null} color={icon?.color ?? null} size={30} />,
  })), [budgets]);
  const commit = (ids: string[]) => mutate((d) => ids.forEach((id, i) => { const b = getRow(d, "budgets", id); if (b && b.sort !== i) save(d, "budgets", { ...b, sort: i } as Budget); }));
  return <ReorderList title="Reorder budgets" items={items} onDone={commit}
    hint="Drag by the grip on the right. The order here is the order on Budgets."
    empty={{ title: "No budgets", hint: "Add one on the Budgets screen first." }} />;
}

/** The icon a budget wears in a list: its single category's, or nothing when it covers several. */
function iconOf(b: Budget, d: Parameters<typeof getRow>[0]): { icon: string | null; color: string | null } | null {
  const ids = budgetCategoryIds(b);
  if (b.tag_id || ids.length !== 1) return null;
  const c = getRow(d, "categories", ids[0]!);
  return c ? { icon: c.icon, color: c.color } : null;
}
