import * as Notifications from "expo-notifications";
import { getRow, listRows, listDebts, plannedNotifications, plannedDebtNotifications, postDueRecurring, formatMinor, DEFAULT_DEBT_NOTIFY_TIME, type RecurringRule } from "@kopiyka/core";
import { mutate } from "@/store";
import { pendingCount } from "./nativeWrites";
import { db } from "@/db";
import { humanDayTime, todayLocal } from "./dates";
import { getPendingReminder, waitDefaultDays } from "./settings";
import { acctName, catName } from "./names";
import { t } from "@/i18n";

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

/** The row a Shortcut-logged payment's notification is about (native/KPNotify.swift), or null for any other notification. */
function noticeRow(data: Record<string, unknown> | undefined): string | null {
  if (typeof data?.transaction_id === "string") return data.transaction_id;
  // Notifications posted before the id was carried on its own still name the row in their link.
  const m = typeof data?.url === "string" ? /^kopiyka:\/\/transaction\/([^/?#]+)$/.exec(data.url) : null;
  return m?.[1] ?? null;
}

/**
 * Take a Shortcut-logged payment's notification off the screen once there is nothing left to do
 * about it: its entry was approved (here, on the watch, on another phone), deleted, or opened.
 *
 * `opened` is the row or the transfer whose sheet is on screen now — looking at the entry is
 * dealing with it, whether or not anything was changed. A transfer counts for both its legs, since
 * the notification names whichever one arrived last.
 *
 * Only ever the automation's own notifications: reminders for recurring payments and debts are
 * left exactly where they are.
 */
export async function dismissSettledPaymentNotices(opened?: string): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const empty = pendingCount() === 0;
    for (const n of shown) {
      // The evening reminder is about the queue as a whole, so it goes once the queue is empty.
      if (n.request.content.data?.kind === PENDING_EVENING) { if (empty) await Notifications.dismissNotificationAsync(n.request.identifier); continue; }
      const id = noticeRow(n.request.content.data);
      if (!id) continue;
      const row = getRow(db, "transactions", id);
      const done = !row || row.deleted === 1 || row.pending !== 1 || id === opened || (!!opened && row.transfer_id === opened);
      if (done) await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  } catch { /* a stale notification is not worth a crash */ }
}

/**
 * Local-only notifications for the phone's whole reminder budget: recurring transactions and
 * debts together, recomputed from scratch on every launch and after every write so the schedule
 * is always derived state. They have to share one pass because iOS caps pending local
 * notifications at 64 and `cancelAllScheduledNotificationsAsync` is global — a second call from
 * a debts-only scheduler would wipe out whatever this function had just scheduled for recurring
 * rules (or vice versa), so both slices are cancelled and rebuilt together here.
 * The Pending queue's evening reminders are rebuilt in the same pass (`schedulePendingEvenings`).
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
  const plan = plannedNotifications(rules, today, 60, waitDefaultDays()).slice(0, 48); // iOS caps pending at 64; debts and the evening reminders share the rest
  let n = 0;
  for (const p of plan) {
    const rule = rules.find((r) => r.id === p.rule_id)!;
    const acc = accounts.get(rule.account_id);
    const cat = rule.category_id ? cats.get(rule.category_id) : undefined;
    const title = rule.payee || (cat ? catName(cat) : null) || t("notify.recurring.fallbackName");
    const amount = acc ? `${formatMinor(Math.abs(rule.amount_minor), acc.currency)} ${acc.currency}` : "";
    const [y, m, d] = p.fire_day.split("-").map(Number) as [number, number, number];
    const [hh, mm] = (rule.time_of_day || "09:00").split(":").map(Number) as [number, number];
    const fireAt = new Date(y, m - 1, d, hh, mm, 0);
    if (fireAt.getTime() < Date.now()) continue;
    const tomorrow = rule.notify_days_before === 1;
    const date = humanDayTime(p.occurrence);
    // A waiting rule has nothing to announce on the day, so its second notification fires once the
    // window has closed and says what is actually news: the charge never turned up. An automatic
    // rule has posted the rule's own amount by then (`runAutoPosting`); a manual one is asking.
    const body = p.kind === "reminder"
      ? (rule.auto_post
        ? (tomorrow ? t("notify.recurring.willPostTomorrow", { amount }) : t("notify.recurring.willPostOn", { amount, date }))
        : (tomorrow ? t("notify.recurring.dueTomorrow", { amount }) : t("notify.recurring.dueOn", { amount, date })))
      : p.kind === "late"
        ? (rule.auto_post ? t("notify.recurring.lateAuto", { date, amount }) : t("notify.recurring.lateManual", { date }))
        : (rule.auto_post
          ? (acc ? t("notify.recurring.postedTo", { amount, account: acctName(acc) }) : t("notify.recurring.postedToYours", { amount }))
          : t("notify.recurring.dueToday", { amount }));
    const settled = p.kind === "due" || p.kind === "late";
    const url = settled && !rule.auto_post ? `kopiyka://recurring/confirm?id=${rule.id}&occurrence=${p.occurrence}` : settled ? "kopiyka://transactions" : "kopiyka://settings/recurring";
    await Notifications.scheduleNotificationAsync({
      content: { title: t(p.kind === "reminder" ? "notify.recurring.upcoming" : p.kind === "late" ? "notify.recurring.notSeen" : rule.auto_post ? "notify.recurring.posted" : "notify.recurring.due", { name: title }), body, data: { url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    n++;
  }
  n += await schedulePendingEvenings();
  const debts = listDebts(db, { settled: false });
  const debtPlan = plannedDebtNotifications(debts, today, 60).slice(0, 12);
  for (const p of debtPlan) {
    const debt = debts.find((deb) => deb.id === p.debt_id)!;
    const [y, m, d] = p.fire_day.split("-").map(Number) as [number, number, number];
    const [hh, mm] = (debt.notify_time || DEFAULT_DEBT_NOTIFY_TIME).split(":").map(Number) as [number, number];
    const fireAt = new Date(y, m - 1, d, hh, mm, 0);
    if (fireAt.getTime() < Date.now()) continue;
    const tomorrow = p.kind === "reminder";
    const amount = `${formatMinor(debt.amount_minor, debt.currency)} ${debt.currency}`;
    const person = debt.person;
    const body = debt.direction === "owed_to_me"
      ? t(tomorrow ? "notify.debt.backTomorrow" : "notify.debt.backToday", { amount })
      : t(tomorrow ? "notify.debt.oweTomorrow" : "notify.debt.oweToday", { person, amount });
    await Notifications.scheduleNotificationAsync({
      content: { title: t(tomorrow ? "notify.debt.tomorrowTitle" : "notify.debt.todayTitle", { person }), body, data: { url: "kopiyka://settings/debts" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    n++;
  }
  return n;
}

/** `data.kind` of the evening reminder; native/KPNotify.swift posts the same, under the same identifiers. */
const PENDING_EVENING = "pending_evening";
/** How many evenings ahead are scheduled: a phone left alone for a few days still hears about it. */
const PENDING_EVENINGS = 3;

/**
 * The evening reminder that something is waiting in the Pending queue — entries a Shortcut or a
 * receipt wrote that still need a category. Recurring payments have their own reminders and their
 * own confirm queue, and are not counted.
 *
 * A local notification cannot ask at 22:00 whether the queue is still full, so the question is
 * asked here instead, after every write: with anything pending, the next few evenings are scheduled
 * with today's count; with nothing, none are (the caller has just cancelled everything). The
 * automation schedules the same identifiers when it writes with the app closed, so an empty queue
 * that fills up overnight is covered too.
 */
async function schedulePendingEvenings(): Promise<number> {
  const time = getPendingReminder();
  const count = pendingCount();
  if (!time || !count) return 0;
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const now = new Date();
  let n = 0;
  for (let day = 0; n < PENDING_EVENINGS; day++) {
    const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, hh, mm, 0);
    if (fireAt.getTime() <= now.getTime()) continue;
    await Notifications.scheduleNotificationAsync({
      // Named by its day, the same as the automation names it: either one's schedule replaces the
      // other's for that evening, and a tap is never mistaken for one already followed (_layout.tsx).
      identifier: `kopiyka.pending.evening.${todayLocal(fireAt)}`,
      content: { title: t("notify.pending.title"), body: t("notify.pending.body", { count }), badge: count, data: { url: "kopiyka://pending", kind: PENDING_EVENING } },
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
 *
 * A rule that waits for the bank is always posted late by definition — the window has to close
 * first — and every one of those is news: nothing was seen leaving the account, so the rule's own
 * amount was written instead. So a waited posting is always announced, whatever day it lands on.
 */
export async function runAutoPosting(): Promise<number> {
  const today = todayLocal();
  const posted = mutate((d) => postDueRecurring(d, today, waitDefaultDays()));
  const n = posted.reduce((a, p) => a + p.days.length, 0);
  const missed = posted.map((p) => ({ ...p, days: p.waited ? p.days : p.days.filter((day) => day < today) })).filter((p) => p.days.length);
  const m = missed.reduce((a, p) => a + p.days.length, 0);
  if (m && (await Notifications.getPermissionsAsync()).granted) {
    const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
    const lines = missed.map((p) => { const a = accounts.get(p.rule.account_id); return `${p.rule.payee ?? t("notify.recurring.missedFallback")} ${a ? formatMinor(Math.abs(p.rule.amount_minor), a.currency) + " " + a.currency : ""}${p.days.length > 1 ? ` ×${p.days.length}` : ""}`; });
    const waited = missed.every((p) => p.waited);
    const title = waited ? t("notify.recurring.neverArrived", { count: m }) : t("notify.recurring.postedMissed", { count: m });
    const body = waited ? t("notify.recurring.neverArrivedBody", { list: lines.join(", ") }) : lines.join(", ");
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { url: "kopiyka://transactions" } }, trigger: null });
  }
  return n;
}
