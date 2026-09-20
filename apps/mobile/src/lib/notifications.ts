import * as Notifications from "expo-notifications";
import { listRows, listDebts, plannedNotifications, plannedDebtNotifications, postDueRecurring, formatMinor, DEFAULT_DEBT_NOTIFY_TIME, type RecurringRule } from "@kopiyka/core";
import { mutate } from "@/store";
import { pendingCount } from "./nativeWrites";
import { db } from "@/db";
import { humanDayTime, todayLocal } from "./dates";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

/**
 * The number on the app icon: entries waiting in the Pending queue, and nothing else.
 *
 * It is what a Shortcut-logged payment is about, and the one number on this phone that means
 * "something here still needs you". Recomputed after every write rather than incremented, so a
 * queue emptied on the watch or on another device settles to the truth by itself. The automation
 * sets it too, from the reply to its own write (native/KPNotify.swift), because with the app closed
 * this code is not running at all.
 *
 * Silently does nothing when badges were not allowed — an install that granted notifications before
 * badges were ever asked for keeps its permission as it was, and only iOS Settings can widen it.
 */
export async function syncBadge(): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await Notifications.setBadgeCountAsync(pendingCount());
  } catch { /* a badge is not worth a crash */ }
}

/**
 * Local-only notifications for the phone's whole reminder budget: recurring transactions and
 * debts together, recomputed from scratch on every launch and after every write so the schedule
 * is always derived state. They have to share one pass because iOS caps pending local
 * notifications at 64 and `cancelAllScheduledNotificationsAsync` is global — a second call from
 * a debts-only scheduler would wipe out whatever this function had just scheduled for recurring
 * rules (or vice versa), so both slices are cancelled and rebuilt together here.
 * Recurring gets two per occurrence: a reminder `notify_days_before` days earlier, and one on the
 * day saying the transaction was posted (automatic rules) or asking to confirm (manual). Debts
 * get a reminder the day before their due date and one on the day itself. Both kinds fire at the
 * row's own time of day (`time_of_day` / `notify_time`), in the phone's local time.
 */
export async function rescheduleRecurringNotifications(): Promise<number> {
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  const rules = listRows(db, "recurring_rules", "deleted=0 AND active=1 AND notify=1") as RecurringRule[];
  const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
  const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
  await Notifications.cancelAllScheduledNotificationsAsync();
  const today = todayLocal();
  const plan = plannedNotifications(rules, today, 60).slice(0, 48); // iOS caps pending at 64; debts share the rest of the budget
  let n = 0;
  for (const p of plan) {
    const rule = rules.find((r) => r.id === p.rule_id)!;
    const acc = accounts.get(rule.account_id);
    const cat = rule.category_id ? cats.get(rule.category_id) : undefined;
    const title = rule.payee || cat?.name || "Recurring transaction";
    const amount = acc ? `${formatMinor(Math.abs(rule.amount_minor), acc.currency)} ${acc.currency}` : "";
    const [y, m, d] = p.fire_day.split("-").map(Number) as [number, number, number];
    const [hh, mm] = (rule.time_of_day || "09:00").split(":").map(Number) as [number, number];
    const fireAt = new Date(y, m - 1, d, hh, mm, 0);
    if (fireAt.getTime() < Date.now()) continue;
    const when = rule.notify_days_before === 1 ? "tomorrow" : `on ${humanDayTime(p.occurrence)}`;
    const body = p.kind === "reminder"
      ? (rule.auto_post ? `${amount} will be posted ${when}.` : `${amount} is due ${when}.`)
      : (rule.auto_post ? `${amount} was posted to ${acc?.name ?? "your account"}.` : `${amount} is due today. Tap to confirm.`);
    const url = p.kind === "due" && !rule.auto_post ? `kopiyka://recurring/confirm?id=${rule.id}&occurrence=${p.occurrence}` : rule.auto_post && p.kind === "due" ? "kopiyka://transactions" : "kopiyka://settings/recurring";
    await Notifications.scheduleNotificationAsync({
      content: { title: p.kind === "reminder" ? `Upcoming: ${title}` : rule.auto_post ? `Posted: ${title}` : `Due: ${title}`, body, data: { url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    n++;
  }
  const debts = listDebts(db, { settled: false });
  const debtPlan = plannedDebtNotifications(debts, today, 60).slice(0, 12);
  for (const p of debtPlan) {
    const debt = debts.find((deb) => deb.id === p.debt_id)!;
    const [y, m, d] = p.fire_day.split("-").map(Number) as [number, number, number];
    const [hh, mm] = (debt.notify_time || DEFAULT_DEBT_NOTIFY_TIME).split(":").map(Number) as [number, number];
    const fireAt = new Date(y, m - 1, d, hh, mm, 0);
    if (fireAt.getTime() < Date.now()) continue;
    const when = p.kind === "reminder" ? "tomorrow" : "today";
    const amount = `${formatMinor(debt.amount_minor, debt.currency)} ${debt.currency}`;
    const body = debt.direction === "owed_to_me" ? `${amount} comes back to you ${when}.` : `You owe ${debt.person} ${amount} ${when}.`;
    await Notifications.scheduleNotificationAsync({
      content: { title: p.kind === "reminder" ? `Tomorrow: ${debt.person}` : `Due today: ${debt.person}`, body, data: { url: "kopiyka://settings/debts" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    n++;
  }
  return n;
}

/** "granted", "denied" (asked and refused; only the Settings app can change it) or "undetermined". */
export async function notificationStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const cur = await Notifications.getPermissionsAsync();
  return cur.granted ? "granted" : cur.canAskAgain ? "undetermined" : "denied";
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
  return r.granted;
}

/**
 * Post due automatic rules. Occurrences for today are announced by the scheduled
 * "posted" notification; only missed (earlier) days get an immediate catch-up note.
 */
export async function runAutoPosting(): Promise<number> {
  const today = todayLocal();
  const posted = mutate((d) => postDueRecurring(d, today));
  const n = posted.reduce((a, p) => a + p.days.length, 0);
  const missed = posted.map((p) => ({ ...p, days: p.days.filter((day) => day < today) })).filter((p) => p.days.length);
  const m = missed.reduce((a, p) => a + p.days.length, 0);
  if (m && (await Notifications.getPermissionsAsync()).granted) {
    const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
    const lines = missed.map((p) => { const a = accounts.get(p.rule.account_id); return `${p.rule.payee ?? "Recurring"} ${a ? formatMinor(Math.abs(p.rule.amount_minor), a.currency) + " " + a.currency : ""}${p.days.length > 1 ? ` ×${p.days.length}` : ""}`; });
    await Notifications.scheduleNotificationAsync({ content: { title: m === 1 ? "Posted a missed recurring transaction" : `Posted ${m} missed recurring transactions`, body: lines.join(", "), data: { url: "kopiyka://transactions" } }, trigger: null });
  }
  return n;
}
