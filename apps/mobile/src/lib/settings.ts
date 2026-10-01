/**
 * Local preferences (not synced): stored in the meta table so they survive reinstalls
 * of the dev client and are included in the full data export.
 */
import { DEFAULT_WAIT_DAYS, getHome, getMeta, setHome, setMeta } from "@kopiyka/core";
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

/**
 * Wait for the bank's own charge before a recurring rule acts on its own.
 *
 * Off by default, and off is exactly what the app did before: rules post (or ask) on the day they
 * name. On, a rule keeps quiet on the day and the charge the notification automation logs claims the
 * occurrence instead (`claimRecurring`), so a subscription is not written once by the rule and once
 * by the bank. Only when the window closes with no charge does the rule act — automatic ones post,
 * manual ones ask, exactly as they always did, only later and only when it is actually needed.
 */
export function getRecurringWait(): boolean { return read("recurring_wait") === "1"; }
export function setRecurringWait(on: boolean): void { write("recurring_wait", on ? "1" : "0"); }

export const WAIT_DAYS_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 21, 30] as const;

/** How long rules wait by default, in days. At least a day; a rule may name its own window instead. */
export function getRecurringWaitDays(): number {
  const v = Math.floor(Number(read("recurring_wait_days") ?? DEFAULT_WAIT_DAYS));
  return Number.isFinite(v) && v >= 1 ? v : DEFAULT_WAIT_DAYS;
}
export function setRecurringWaitDays(d: number): void { write("recurring_wait_days", String(Math.max(1, Math.floor(d)))); }

/**
 * The window every core call takes: the default in days, or 0 when waiting is off — the one place
 * the switch is turned into a number, so no screen has to remember to check both.
 */
export function waitDefaultDays(): number { return getRecurringWait() ? getRecurringWaitDays() : 0; }

/** Default reminder lead time for new recurring rules, in days. */
export function getReminderDaysBefore(): number { const v = Number(read("recurring_notify_days_before") ?? 1); return Number.isFinite(v) && v >= 0 ? v : 1; }
export function setReminderDaysBefore(d: number): void { write("recurring_notify_days_before", String(d)); }

/** Remember a coarse location with each logged transaction and suggest categories from it. */
export function getLocationEnabled(): boolean { return read("location_enabled") === "1"; }
export function setLocationEnabled(on: boolean): void { write("location_enabled", on ? "1" : "0"); }
/** Home: no category is suggested near it (core `suggestCategoryAt`; the watch bridge applies the same rule). */
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
/** The Budgets screen's sections, top to bottom. Missing or unknown entries fall back to the default order. */
export type BudgetsSection = "budgets" | "spending" | "travel";
export const BUDGETS_SECTIONS: BudgetsSection[] = ["budgets", "spending", "travel"];
export function getBudgetsSections(): BudgetsSection[] {
  let saved: unknown = [];
  try { saved = JSON.parse(read("budgets_sections") ?? "[]"); } catch { /* the default */ }
  const known = (Array.isArray(saved) ? saved : []).filter((x): x is BudgetsSection => BUDGETS_SECTIONS.includes(x as BudgetsSection));
  return [...new Set([...known, ...BUDGETS_SECTIONS])];
}
export function setBudgetsSections(order: BudgetsSection[]): void { write("budgets_sections", JSON.stringify(order)); }

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
