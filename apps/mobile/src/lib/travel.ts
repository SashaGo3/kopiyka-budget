/**
 * Travel mode on the phone: thin wrappers over core `trips.ts` plus the hooks the screens use.
 * The trip itself is a synced budget row, so nothing here is stored locally.
 */
import { activeTrip, addPastTrip, endTrip, getRow, startTrip, tripStats, type Budget, type PastTrip, type StartTrip, type TripStats } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { getBaseCurrency } from "./rates";
import { getCurrentAccount } from "./settings";
import { t } from "@/i18n";

/** Currency a new trip budget is entered in: the current account's, else the base currency. */
export function tripCurrency(): string {
  const cur = getCurrentAccount();
  return (cur ? getRow(db, "accounts", cur)?.currency : null) ?? getBaseCurrency();
}

export function useActiveTrip(): Budget | null { return useQuery((d) => activeTrip(d)); }

/** Live stats for a trip; recomputed after every write (new expense, rate fetched). */
export function useTripStats(b: Budget | null): TripStats | null {
  return useQuery((d) => (b ? tripStats(d, b) : null), [b?.id, b?.updated_at]);
}

export function startTravel(p: StartTrip) { return mutate((d) => startTrip(d, p)); }
export function endTravel(budgetId: string) { return mutate((d) => endTrip(d, budgetId)); }
export function addPastTravel(p: PastTrip) { return mutate((d) => addPastTrip(d, p)); }

export function tripLine(s: TripStats): string {
  const fmt = (m: number) => (m / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const spent = t("travel.line.spent", { spent: fmt(s.spent_minor), limit: fmt(s.limit_minor), currency: s.currency });
  const day = s.days_left ? t("travel.line.dayOf", { day: s.day, days: s.days }) : t("travel.line.day", { day: s.day });
  return `${tripName(s)} · ${spent} · ${day}`;
}

/** A trip's name: its tag's, or a word in the app's language when the tag has gone. */
export function tripName(s: Pick<TripStats, "name">): string { return s.name ?? t("travel.untitled"); }
