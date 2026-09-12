/**
 * Snapshot for WidgetKit and the watch: a small JSON file in the App Group container,
 * rewritten after every change. The Swift side reads it; no bridge needed for reads.
 * Reload is requested through the native module when available (added in phase 4).
 */
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { KPBridge } from "@/lib/bridge";
import { accountBalanceMinor, activeTrip, budgetRows, iconFor, listRows, fromMinor, tripStats } from "@kopiyka/core";
import { db, APP_GROUP } from "@/db";
import { currentPeriod } from "./period";
import { getBudgetScope } from "./settings";
import { scopeAccount, scopeAccountIds } from "./scope";
import { buildWatchState } from "./watchState";

export interface WidgetSnapshot {
  generated_at: string;
  accounts: { id: string; name: string; currency: string; balance: number }[];
  net_worth: { currency: string; amount: number }[];
  budgets: { category_id: string | null; name: string; currency: string; limit: number; spent: number }[];
  /** Travel mode, when on: the trip budget and its daily allowance. The watch pre-ticks `tag_id` on new expenses. */
  trip: { budget_id: string; tag_id: string; name: string; currency: string; limit: number; spent: number; day: number; days: number; days_left: number; allowance: number | null } | null;
  month: string;
  /** Icon + colour per category exactly as the app draws them (watch and intents reuse this). */
  category_icons: Record<string, { icon: string; color: string }>;
}

export function buildSnapshot(): WidgetSnapshot {
  const accounts = listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name");
  const accs = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance: fromMinor(accountBalanceMinor(db, a.id), a.currency) }));
  const nw = new Map<string, number>();
  for (const a of accounts) if (a.include_in_net_worth) nw.set(a.currency, (nw.get(a.currency) ?? 0) + accountBalanceMinor(db, a.id));
  // Same period, account scope and spend rule as the Budgets tab (budget start day, e.g. 15 Aug – 14 Sep).
  const period = currentPeriod();
  const scope = getBudgetScope();
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  const scopeIds = scopeAccountIds(scope, listRows(db, "accounts", "deleted=0"));
  const out: WidgetSnapshot["budgets"] = budgetRows(db, { start: period.start, end: period.end, accountIds: scopeIds, budgetAccount: scopeAccount(scope) }).map((r) => ({
    category_id: r.budget.category_id, name: r.budget.category_id ? cats.get(r.budget.category_id)?.name ?? "?" : "Everything", currency: r.budget.currency,
    limit: fromMinor(r.budget.amount_minor, r.budget.currency), spent: fromMinor(r.spent_minor, r.budget.currency),
  }));
  const label = period.subtitle ? `${period.title} · ${period.subtitle}` : period.title;
  const t = activeTrip(db);
  const ts = t ? tripStats(db, t) : null;
  const trip: WidgetSnapshot["trip"] = t && ts && t.tag_id ? {
    budget_id: t.id, tag_id: t.tag_id, name: ts.name, currency: ts.currency, limit: fromMinor(ts.limit_minor, ts.currency), spent: fromMinor(ts.spent_minor, ts.currency),
    day: ts.day, days: ts.days, days_left: ts.days_left, allowance: ts.allowance_minor === null ? null : fromMinor(ts.allowance_minor, ts.currency),
  } : null;
  const category_icons: WidgetSnapshot["category_icons"] = {};
  for (const c of cats.values()) if (!c.deleted) category_icons[c.id] = iconFor(c.name, { icon: c.icon, color: c.color });
  return {
    generated_at: new Date().toISOString(), accounts: accs, month: label, category_icons, trip,
    net_worth: [...nw].map(([currency, m]) => ({ currency, amount: fromMinor(m, currency) })),
    budgets: out,
  };
}

let lastSnapshot = "";
let lastState = "";
export function writeWidgetSnapshot(): void {
  if (Platform.OS !== "ios") return;
  try {
    const dir = Paths.appleSharedContainers[APP_GROUP];
    if (!dir) return;
    const snap = buildSnapshot();
    const snapJson = JSON.stringify({ ...snap, generated_at: "" });
    const snapChanged = snapJson !== lastSnapshot;
    // The watch state carries the snapshot too (history/tags can change without touching balances,
    // so it needs its own dirty check); strip both timestamps or every build would look "changed".
    const state = buildWatchState(snap);
    const stateJson = JSON.stringify({ ...state, generated_at: "", snapshot: { ...state.snapshot, generated_at: "" } });
    const stateChanged = stateJson !== lastState;
    if (!snapChanged && !stateChanged) return; // nothing the widgets or the watch would notice
    // Write the files before poking native — updateWatch() reads watch-state.json straight off disk.
    if (snapChanged) { lastSnapshot = snapJson; new File(dir, "widget-snapshot.json").write(JSON.stringify(snap)); }
    if (stateChanged) { lastState = stateJson; new File(dir, "watch-state.json").write(JSON.stringify(state)); }
    if (snapChanged) KPBridge.reloadWidgets();
    if (stateChanged) KPBridge.updateWatch();
  } catch {
    // Widgets are best-effort; never let them break a write.
  }
}
