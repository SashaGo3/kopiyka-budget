/**
 * How each kind of insight looks in the app. Core says what a kind is (`INSIGHT_KINDS`); the symbol
 * it wears on its card, in the picker and on the reorder list is a matter for this side.
 */
import type { SFSymbol } from "expo-symbols";
import { INSIGHT_KINDS, type Insight, type InsightKind } from "@kopiyka/core";

export const INSIGHT_LOOK: Record<InsightKind, { icon: SFSymbol; color: string }> = {
  free_money: { icon: "banknote", color: "#34C759" },
  days_to_salary: { icon: "calendar.badge.clock", color: "#007AFF" },
  savings_goal: { icon: "flag.checkered", color: "#30B0C7" },
  account_balance: { icon: "creditcard", color: "#5856D6" },
  checklist: { icon: "checklist", color: "#FF9F0A" },
  subscriptions: { icon: "repeat.circle", color: "#AF52DE" },
  recurring_spend: { icon: "arrow.triangle.2.circlepath", color: "#FF2D55" },
  upcoming: { icon: "clock.arrow.circlepath", color: "#5AC8FA" },
  regular: { icon: "chart.bar", color: "#A2845E" },
  values: { icon: "heart.text.square", color: "#FF3B30" },
  safety_buffer: { icon: "lifepreserver", color: "#32ADE6" },
  safe_to_spend: { icon: "checkmark.shield", color: "#34C759" },
};

/**
 * The kinds the "Add insight" list still offers. A kind with nothing to set (`instant`) makes the
 * same card every time, so once there is one a second is only a duplicate and it is not offered;
 * a kind with settings — a savings goal, a checklist — can sensibly be added again for another
 * account or another set of categories.
 */
export function addableKinds(existing: Pick<Insight, "kind">[]): typeof INSIGHT_KINDS {
  const have = new Set(existing.map((i) => i.kind));
  return INSIGHT_KINDS.filter((k) => !(k.instant && have.has(k.kind)));
}
