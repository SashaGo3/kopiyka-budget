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
