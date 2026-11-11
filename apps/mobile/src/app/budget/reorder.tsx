import { useMemo } from "react";
import { activeBudgets, budgetCategoryIds, debtTotals, formatMinor, getRow, listDebts, listTrips, personBalances, remove, save, type Budget } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { mutate, useQuery } from "@/store";
import { CategoryIcon } from "@/components/ui";
import { themeTone } from "@/constants/theme";
import { ReorderList, type ReorderItem } from "@/components/ReorderList";
import { budgetTitle, nameMaps } from "@/lib/budgetName";
import { getBudgetScope, getBudgetsSections, setBudgetsSections, type BudgetsSection } from "@/lib/settings";
import { scopeAccount } from "@/lib/scope";
import { todayLocal } from "@/lib/dates";
import { t } from "@/i18n";

/**
 * Drag the budgets into the order you want them on the Budgets screen, and the screen's sections
 * with them, and swipe a budget left to delete it. The drag and the swipe are `ReorderList`.
 *
 * Every section of the screen is a header, the budgets one with the budgets under it. A header
 * carries its whole section (`ReorderList` folds the list while one is in the hand), and a budget
 * moves only among the budgets (`keepInSection`) — the budgets are one block on the screen, so a
 * budget dropped between Spending and Past trips would have nowhere to go.
 */
export default function BudgetReorder() {
  const budgets = useQuery((d) => {
    const names = nameMaps(d);
    return activeBudgets(d, todayLocal(), scopeAccount(getBudgetScope())).map((b) => ({ b, title: budgetTitle(b, names), icon: iconOf(b, d) }));
  });
  const hasTravel = useQuery((d) => listTrips(d).some((t) => t.ended));
  // Owed to you is only on the screen when it has something to show, and so only in this list then.
  const hasOwed = useQuery((d) => personBalances(d).length > 0 || debtTotals(listDebts(d, { settled: false })).length > 0);
  const items = useMemo(() => getBudgetsSections().flatMap((sec): ReorderItem[] => {
    if (sec === "budgets") return budgets.length ? [sectionRow("budgets"), ...budgets.map(({ b, title, icon }) => ({
      id: b.id, title, deletable: true,
      subtitle: b.in_planned === 0 ? t("budgets.reorder.amountOff", { amount: `${formatMinor(b.amount_minor, b.currency)} ${b.currency}` }) : `${formatMinor(b.amount_minor, b.currency)} ${b.currency}`,
      icon: <CategoryIcon name={title} icon={icon?.icon ?? null} color={icon?.color ?? null} size={30} />,
    }))] : [];
    if (sec === "travel" && !hasTravel) return [];
    if (sec === "owed" && !hasOwed) return [];
    return [sectionRow(sec)];
  }), [budgets, hasTravel, hasOwed]);
  const commit = (ids: string[], removed: string[]) => {
    const budgetIds = ids.filter((id) => !id.startsWith(SECTION));
    mutate((d) => {
      for (const id of removed) remove(d, "budgets", id);
      budgetIds.forEach((id, i) => { const b = getRow(d, "budgets", id); if (b && b.sort !== i) save(d, "budgets", { ...b, sort: i } as Budget); });
    });
    // A section that is not in the list (no budgets yet, no past travel) keeps its place in the saved order.
    const saved = getBudgetsSections();
    const at = (sec: BudgetsSection) => {
      const i = ids.indexOf(SECTION + sec);
      return i < 0 ? saved.indexOf(sec) - 0.5 : i;
    };
    setBudgetsSections([...saved].sort((a, z) => at(a) - at(z)));
  };
  return <ReorderList title={t("budgets.reorder.title")} items={items} onDone={commit} keepInSection
    hint={t("budgets.reorder.hint")}
    empty={{ title: t("budgets.reorder.emptyTitle"), hint: t("budgets.reorder.emptyHint") }} />;
}

const SECTION = "section:";
const sectionIcon = (name: "chart.bar.fill" | "airplane" | "person.2.fill" | "chart.pie.fill", color: string) => (
  <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: themeTone(color).fill, alignItems: "center", justifyContent: "center" }}>
    <SymbolView name={name} size={15} tintColor={themeTone(color).glyph} />
  </View>
);
const sectionRow = (sec: BudgetsSection): ReorderItem => sec === "budgets"
  ? { id: SECTION + "budgets", section: true, title: t("budgets.reorder.budgetsTitle"), subtitle: t("budgets.reorder.budgetsSection"), icon: sectionIcon("chart.pie.fill", "#34C759") }
  : sec === "owed"
  ? { id: SECTION + "owed", section: true, title: t("people.card.title"), subtitle: t("people.card.reorderSection"), icon: sectionIcon("person.2.fill", "#AF52DE") }
  : sec === "spending"
  ? { id: SECTION + "spending", section: true, title: t("budgets.spending.title"), subtitle: t("budgets.reorder.spendingSection"), icon: sectionIcon("chart.bar.fill", "#FF9F0A") }
  : { id: SECTION + "travel", section: true, title: t("budgets.travelHistory.title"), subtitle: t("budgets.reorder.travelSection"), icon: sectionIcon("airplane", "#0A84FF") };

/** The icon a budget wears in a list: its single category's, or nothing when it covers several. */
function iconOf(b: Budget, d: Parameters<typeof getRow>[0]): { icon: string | null; color: string | null } | null {
  const ids = budgetCategoryIds(b);
  if (b.tag_id || ids.length !== 1) return null;
  const c = getRow(d, "categories", ids[0]!);
  return c ? { icon: c.icon, color: c.color } : null;
}
