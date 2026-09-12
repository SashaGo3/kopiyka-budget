/**
 * Budget periods. One global "month starts on day N" setting (e.g. 15 = salary day).
 * A period is named after the month it starts in, like Budget Flow: on 7 Sep with
 * start day 15 you are in "Aug 2026" (15 Aug – 14 Sep).
 */
import { useSyncExternalStore } from "react";
import { budgetPeriod, getMeta, setMeta } from "@kopiyka/core";
import { db } from "@/db";
import { monthPill, periodLabel, todayLocal } from "./dates";

export function getPeriodStartDay(): number {
  const v = Number(getMeta(db, "period_start_day") ?? 1);
  return Number.isFinite(v) && v >= 1 && v <= 28 ? v : 1;
}
export function setPeriodStartDay(d: number): void { setMeta(db, "period_start_day", String(d)); resetSelectedPeriod(); }

export interface Period { start: string; end: string; title: string; subtitle: string | null }

export function periodContaining(day: string, startDay = getPeriodStartDay()): Period {
  const { start, end } = budgetPeriod(day, startDay);
  return { start, end, title: monthPill(start), subtitle: startDay === 1 ? null : periodLabel(start, end) };
}

export function currentPeriod(startDay = getPeriodStartDay()): Period {
  return periodContaining(todayLocal(), startDay);
}

/** Neighbouring period: step from the start date by whole months. */
export function shiftPeriod(p: Period, delta: number, startDay = getPeriodStartDay()): Period {
  const [y, m] = p.start.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const anchor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(startDay, 28)).padStart(2, "0")}`;
  return periodContaining(anchor, startDay);
}

/**
 * The period Budgets and Transactions are both looking at. One in-memory selection shared by the
 * two screens, so a month picked on either is already picked on the other; it starts on the
 * current period every launch, and changing the start day puts it back there.
 */
let selected: Period | null = null;
const listeners = new Set<() => void>();
function snapshot(): Period { return (selected ??= currentPeriod()); }
function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function setSelectedPeriod(p: Period): void { selected = p; for (const l of listeners) l(); }
export function resetSelectedPeriod(): void { setSelectedPeriod(currentPeriod()); }

/** `[period, setPeriod]`, shared across the screens that show a period pill. */
export function usePeriod(): [Period, (p: Period) => void] {
  return [useSyncExternalStore(subscribe, snapshot, snapshot), setSelectedPeriod];
}
