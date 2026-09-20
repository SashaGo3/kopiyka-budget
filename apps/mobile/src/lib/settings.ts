/**
 * Local preferences (not synced): stored in the meta table so they survive reinstalls
 * of the dev client and are included in the full data export.
 */
import { getHome, getMeta, setHome, setMeta } from "@kopiyka/core";
import { db } from "@/db";
import { notifyChange } from "@/store";

function read(key: string): string | null { return getMeta(db, key); }
function write(key: string, value: string): void { setMeta(db, key, value); notifyChange(); }

/**
 * A notification for each payment the Shortcut automation logs. On unless turned off: the
 * automation writes with the app closed, and a purchase you never hear about is one you find out
 * about in a list days later. Only one is ever on screen — a new payment replaces the last
 * (native/KPNotify.swift) — and it does nothing at all until iOS notifications are allowed.
 */
export function getShortcutNotify(): boolean { return read("shortcut_notify") !== "0"; }
export function setShortcutNotify(on: boolean): void { write("shortcut_notify", on ? "1" : "0"); }

/** Default reminder lead time for new recurring rules, in days. */
export function getReminderDaysBefore(): number { const v = Number(read("recurring_notify_days_before") ?? 1); return Number.isFinite(v) && v >= 0 ? v : 1; }
export function setReminderDaysBefore(d: number): void { write("recurring_notify_days_before", String(d)); }

/** Remember a coarse location with each logged transaction and suggest categories from it. */
export function getLocationEnabled(): boolean { return read("location_enabled") === "1"; }
export function setLocationEnabled(on: boolean): void { write("location_enabled", on ? "1" : "0"); }
/** Home: no category is suggested near it (core `suggestCategoryNear`; the watch bridge applies the same rule). */
export function getHomeLocation(): { lat: number; lon: number; place: string | null } | null { return getHome(db); }
export function setHomeLocation(home: { lat: number; lon: number; place: string | null } | null): void { setHome(db, home); notifyChange(); }

/**
 * Show the account's balance on the entry sheet from the moment it opens, instead of keeping it
 * folded behind the chevron. Off by default: the sheet is the one screen most likely to be seen
 * over someone's shoulder, so the numbers stay hidden until the phone's owner asks for them.
 */
export function getShowBalance(): boolean { return read("show_balance") === "1"; }
export function setShowBalance(on: boolean): void { write("show_balance", on ? "1" : "0"); }

/**
 * Hide income rows from the Transactions list. A display preference, not a filter: it does not
 * count towards the filter badge, and an explicit "Income" type filter still wins, so choosing
 * Income from the filter sheet never lands on a deliberately empty list.
 */
export function getHideIncome(): boolean { return read("hide_income") === "1"; }
export function setHideIncome(on: boolean): void { write("hide_income", on ? "1" : "0"); }

/** Account scope for Budgets / Insights / Transactions: "" = all, "group:<name>" or an account id (see lib/scope.ts). */
export function getBudgetScope(): string { return read("budget_scope") ?? ""; }
export function setBudgetScope(s: string): void { write("budget_scope", s); }

/** Account the app should treat as "current": default for logging, and the Budgets scope. "" = none. */
export function getCurrentAccount(): string { return read("current_account") ?? ""; }
export function setCurrentAccount(id: string): void { write("current_account", id); setBudgetScope(id); }

/**
 * How long backups are kept, in days (`keepDays` in BACKUP_POLICY). This is the storage dial: the
 * container holds up to `perDay` files for each day inside the window and nothing outside it, so
 * halving the window halves the space in iCloud. It replaced "Backups per day" on 2026-09-18 —
 * how *finely* a day is covered matters far less than how many days are being paid for.
 */
export const BACKUP_KEEP_DAYS_OPTIONS = [3, 7, 14, 30, 90] as const;
export const DEFAULT_KEEP_DAYS = 30;
export function getBackupKeepDays(): number {
  const v = Number(read("backup_keep_days") ?? DEFAULT_KEEP_DAYS);
  return (BACKUP_KEEP_DAYS_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_KEEP_DAYS;
}
export function setBackupKeepDays(n: number): void { write("backup_keep_days", String(n)); }

export const REMINDER_OPTIONS = [
  { value: "0", label: "On the day" }, { value: "1", label: "1 day before" }, { value: "2", label: "2 days before" },
  { value: "3", label: "3 days before" }, { value: "7", label: "A week before" },
];
