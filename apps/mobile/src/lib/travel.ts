/**
 * Travel mode on the phone: thin wrappers over core `trips.ts` plus the hooks the screens use.
 * The trip itself is a synced budget row, so nothing here is stored locally.
 */
import { activeTrip, endTrip, getRow, startTrip, tripStats, type Budget, type StartTrip, type TripStats } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { getBaseCurrency } from "./rates";
import { getCurrentAccount } from "./settings";

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

export function tripLine(s: TripStats): string {
  const fmt = (m: number) => (m / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${s.name} · ${fmt(s.spent_minor)} of ${fmt(s.limit_minor)} ${s.currency} · day ${s.day}${s.days_left ? ` of ${s.days}` : ""}`;
}
