import { useMemo } from "react";
import { activeBudgets, budgetCategoryIds, formatMinor, getRow, listTrips, save, type Budget } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { mutate, useQuery } from "@/store";
import { CategoryIcon } from "@/components/ui";
import { ReorderList, type ReorderItem } from "@/components/ReorderList";
import { budgetTitle, nameMaps } from "@/lib/budgetName";
import { getBudgetScope, getBudgetsSections, setBudgetsSections, type BudgetsSection } from "@/lib/settings";
import { scopeAccount } from "@/lib/scope";
import { todayLocal } from "@/lib/dates";

/**
 * Drag the budgets into the order you want them on the Budgets screen, and the screen's sections
 * with them. The drag is `ReorderList`.
 *
 * One list rather than two: the budgets are rows, and Spending and Travel history are a row each
 * standing for their whole section. Where the budgets go as a block is where the first of them is,
 * so dragging Spending above the first budget puts Spending above the budgets.
 */
export default function BudgetReorder() {
  const budgets = useQuery((d) => {
    const names = nameMaps(d);
    return activeBudgets(d, todayLocal(), scopeAccount(getBudgetScope())).map((b) => ({ b, title: budgetTitle(b, names), icon: iconOf(b, d) }));
  });
  const hasTravel = useQuery((d) => listTrips(d).some((t) => t.ended));
  const items = useMemo(() => getBudgetsSections().flatMap((sec) => {
    if (sec === "budgets") return budgets.map(({ b, title, icon }) => ({
      id: b.id, title,
      subtitle: `${formatMinor(b.amount_minor, b.currency)} ${b.currency}${b.in_planned === 0 ? " · not in Planned" : ""}`,
      icon: <CategoryIcon name={title} icon={icon?.icon ?? null} color={icon?.color ?? null} size={30} />,
    }));
    if (sec === "travel" && !hasTravel) return [];
    return [SECTION_ROWS[sec]];
  }), [budgets, hasTravel]);
  const commit = (ids: string[]) => {
    const budgetIds = ids.filter((id) => !id.startsWith(SECTION));
    mutate((d) => budgetIds.forEach((id, i) => { const b = getRow(d, "budgets", id); if (b && b.sort !== i) save(d, "budgets", { ...b, sort: i } as Budget); }));
    // A section that is not in the list (no budgets yet, no past travel) keeps its place in the saved order.
    const saved = getBudgetsSections();
    const at = (sec: BudgetsSection) => {
      const i = sec === "budgets" ? ids.findIndex((id) => !id.startsWith(SECTION)) : ids.indexOf(SECTION + sec);
      return i < 0 ? saved.indexOf(sec) - 0.5 : i;
    };
    setBudgetsSections([...saved].sort((a, z) => at(a) - at(z)));
  };
  return <ReorderList title="Reorder budgets" items={items} onDone={commit}
    hint="Drag by the grip on the right. Spending and Travel history move as whole sections."
    empty={{ title: "No budgets", hint: "Add one on the Budgets screen first." }} />;
}

const SECTION = "section:";
const sectionIcon = (name: "chart.bar.fill" | "airplane", color: string) => (
  <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
    <SymbolView name={name} size={15} tintColor="#fff" />
  </View>
);
const SECTION_ROWS: Record<Exclude<BudgetsSection, "budgets">, ReorderItem> = {
  spending: { id: SECTION + "spending", title: "Spending", subtitle: "Section · what each category cost", icon: sectionIcon("chart.bar.fill", "#FF9F0A") },
  travel: { id: SECTION + "travel", title: "Travel history", subtitle: "Section · past travel budgets", icon: sectionIcon("airplane", "#0A84FF") },
};

/** The icon a budget wears in a list: its single category's, or nothing when it covers several. */
function iconOf(b: Budget, d: Parameters<typeof getRow>[0]): { icon: string | null; color: string | null } | null {
  const ids = budgetCategoryIds(b);
  if (b.tag_id || ids.length !== 1) return null;
  const c = getRow(d, "categories", ids[0]!);
  return c ? { icon: c.icon, color: c.color } : null;
}
