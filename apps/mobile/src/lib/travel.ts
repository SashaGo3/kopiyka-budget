/**
 * Travel mode on the phone: thin wrappers over core `trips.ts` plus the hooks the screens use.
 * The trip itself is a synced budget row, so nothing here is stored locally.
 */
import { activeTrip, addPastTrip, endTrip, getRow, startTrip, tripKind, tripStats, type Budget, type PastTrip, type StartTrip, type TripKind, type TripStats } from "@kopiyka/core";
import type { SFSymbol } from "expo-symbols";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { getBaseCurrency } from "./rates";
import { getCurrentAccount } from "./settings";
import { humanDayTime, todayLocal } from "./dates";
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
  const spent = s.limited ? t("travel.line.spent", { spent: fmt(s.spent_minor), limit: fmt(s.limit_minor), currency: s.currency }) : t("travel.line.spentNoLimit", { spent: fmt(s.spent_minor), currency: s.currency });
  const day = s.active && s.budget.starts > todayLocal() ? t("travel.line.startsOn", { date: humanDayTime(s.budget.starts) })
    : s.days_left ? t("travel.line.dayOf", { day: s.day, days: s.days }) : t("travel.line.day", { day: s.day });
  return `${tripName(s)} · ${spent} · ${day}`;
}

/** A trip's or event's name: its tag's, or a word in the app's language when the tag has gone. */
export function tripName(s: Pick<TripStats, "name" | "budget">): string { return s.name ?? t("travel.untitled", { kind: tripKind(s.budget) }); }

/**
 * How a trip or an event is drawn wherever it is chrome: the icon, and the colour (iOS blue for a
 * trip, pink for an event, passed through `themeTone`/`themeHue` like any other).
 */
export function tripLook(kind: TripKind | Pick<Budget, "kind"> | null | undefined): { icon: SFSymbol; color: string } {
  return tripKind(typeof kind === "string" ? { kind } : kind) === "event" ? { icon: "party.popper.fill", color: "#FF2D55" } : { icon: "airplane", color: "#0A84FF" };
}
