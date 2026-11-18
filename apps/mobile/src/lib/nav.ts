/**
 * Leaving a card modal for a screen underneath it — the tag and category editors' "show me these
 * transactions".
 *
 * This used to be `router.back()` followed by a `setTimeout` guessing when the dismissal had
 * finished. Two problems with that: the guess was 350 ms in both editors while the rest of the app
 * waits 450 ms for a *sheet* to be gone, and a card modal takes longer to dismiss than a sheet. Push
 * while iOS is still dismissing and the presentation is dropped, or the stack is left holding a
 * screen that is on the glass but is no longer the route the navigator thinks is focused — and the
 * next push from it, the category picker, then goes nowhere at all. One tap, nothing happens.
 *
 * `dismissTo` is a single POP_TO: it pops back to the route and merges the new params in one
 * transition, so there is no window to race. The old path is kept only for the case where there is
 * nothing to dismiss, and with the 450 ms the rest of the app settled on.
 */
import { router, type Href } from "expo-router";

/** How long the app waits for a presented screen to be gone before touching navigation again. */
export const DISMISS_MS = 450;

export function dismissTo(href: Href): void {
  if (router.canDismiss()) { router.dismissTo(href); return; }
  router.back();
  setTimeout(() => router.push(href), DISMISS_MS);
}

const opened = new Map<string, number>();

/**
 * For a screen that opens another on its own (from an effect, not a tap): `open` runs once per `id`
 * however many times it is asked within `windowMs`. A screen can mount twice — dev mode does it on
 * purpose, a remount does it by accident — and each mount asking meant two screens stacked, the
 * second invisible under the first, and every picker opened after that went under both. The
 * duplicates come within a second of each other; the window is measured from the first open, so the
 * same screen opened again later opens normally. True when `open` ran.
 */
export function openOnce(id: string, open: () => void, windowMs = 1500): boolean {
  const now = Date.now();
  const last = opened.get(id);
  if (last !== undefined && now - last < windowMs) return false;
  opened.set(id, now);
  open();
  return true;
}

/** A fresh `nonce` param: tells a screen already open that it was opened again (transactions/index.tsx). */
export function freshNonce(): string { return String(Date.now()); }
