/**
 * "A payment is on its way": the placeholder row the transaction list shows while the notification
 * automation (native LogPaymentIntent) reads a bank notification with the app open.
 *
 * The automation says when it starts and when it is done (op "incoming", lib/nativeWrites.ts), and
 * the row it writes names the placeholder it replaces. It also keeps every reading under way in the
 * app group (native `KPIncoming`), because the app it would tell is often not running yet: a
 * notification arrives, the automation starts, you open the app — and the placeholder is there,
 * because `syncIncoming` read it on launch and again on every return to the foreground. So:
 *
 * - **One placeholder**, however many notifications are being read at once: a second one arriving
 *   while the first is still showing adds nothing to the screen.
 * - **Not for a blink.** Shown only once a reading has taken `SHOW_AFTER_MS`, so a notification that
 *   turns out to be no payment at all (a promo from the bank app) usually never shows one; and once
 *   shown it stays at least `MIN_SHOWN_MS`, so it reads as a placeholder rather than a flicker.
 * - **Replaced, not stacked.** The row written takes the placeholder's place in the same render
 *   (`landed`), with the layout change animated, so it fades in where the placeholder fades out.
 *   Anything else — unreadable, no account, a twin filled in, a failure — just lets it go.
 * - **Never stuck.** A reading that never reports back (the automation was killed) is dropped
 *   `GIVE_UP_MS` after it started, and one native has forgotten is dropped on the next sync.
 *
 * Nothing here is data: it lives in memory only, and a reload forgets it.
 */
import { useSyncExternalStore } from "react";
import { animateNextLayout } from "./motion";

const SHOW_AFTER_MS = 250;
const MIN_SHOWN_MS = 600;
const GIVE_UP_MS = 30_000;

/** Readings in progress, by the automation's token, each with the timer that gives up on it. */
const active = new Map<string, ReturnType<typeof setTimeout>>();
let shown = false;
let shownAt = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void { for (const l of listeners) l(); }

function setShown(v: boolean): void {
  if (shown === v) return;
  animateNextLayout();
  shown = v;
  shownAt = v ? Date.now() : 0;
  emit();
}

/** Nothing is being read any more: hide, now or once the placeholder has been up long enough. */
function settle(immediately: boolean): void {
  if (active.size) return;
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (!shown) return;
  if (hideTimer) clearTimeout(hideTimer);
  const left = immediately ? 0 : MIN_SHOWN_MS - (Date.now() - shownAt);
  if (left <= 0) { hideTimer = null; setShown(false); return; }
  hideTimer = setTimeout(() => { hideTimer = null; if (!active.size) setShown(false); }, left);
}

/** The automation started reading a notification, at `startedAt` (ms; now unless it began before the app heard). */
export function incomingStarted(token: string, startedAt = Date.now()): void {
  if (active.has(token)) return;
  const age = Math.max(0, Date.now() - startedAt);
  if (age >= GIVE_UP_MS) return;
  active.set(token, setTimeout(() => incomingEnded(token), GIVE_UP_MS - age));
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (shown || showTimer) return;
  // A reading already under way when the app opened has had its chance to be quick: show it at once.
  const wait = SHOW_AFTER_MS - age;
  if (wait <= 0) setShown(true);
  else showTimer = setTimeout(() => { showTimer = null; if (active.size) setShown(true); }, wait);
}

/**
 * Line up with what native says is being read right now (token → start, ms): start what is new,
 * end what native no longer has. Native is the record; the signals only make the open app quicker.
 */
export function syncIncoming(readings: Record<string, number>): void {
  for (const token of [...active.keys()]) if (!(token in readings)) incomingEnded(token);
  for (const [token, startedAt] of Object.entries(readings)) incomingStarted(token, startedAt);
}

/** The automation is done with a notification, whatever came of it. */
export function incomingEnded(token: string): void {
  const t = active.get(token);
  if (!t) return;
  clearTimeout(t);
  active.delete(token);
  settle(false);
}

/**
 * The automation is writing the row for this reading. Call it right before the write lands, so the
 * placeholder goes in the same render the row arrives in — one animated swap, never both on screen.
 */
export function incomingLanded(token: string | null): void {
  if (!token) return;
  const t = active.get(token);
  if (t) { clearTimeout(t); active.delete(token); }
  if (active.size) return;   // another reading is still under way: the one placeholder stays for it
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (shown) { shown = false; shownAt = 0; emit(); }
  // The row itself is a new item in the list: animate its arrival whether or not a placeholder was up.
  animateNextLayout();
}

function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Whether the placeholder row is showing. */
export function useIncoming(): boolean {
  return useSyncExternalStore(subscribe, () => shown, () => false);
}
