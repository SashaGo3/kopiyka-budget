/**
 * How the Transactions list moves when the month changes — pure, so test/listMotion.test.ts can hold
 * it to what it promises without a simulator.
 */

/**
 * How far down the list (points of content offset) before it starts keeping the rows under your
 * finger still while new ones land above them (`maintainVisibleContentPosition`).
 *
 * Kept on all the time, it also "kept" the top of a list that had just become short — an empty
 * month — by pushing it down past where the list rests: a gap opened under the title, deep enough
 * for iOS to read it as a pull and start the refresh spinner, and it jumped back on the next switch.
 * At the top there is nothing under a finger to keep, so it is off there; by the time the rows have
 * scrolled past the month's header it is on, which is the only place it ever did any good.
 */
export const KEEP_POSITION_FROM = 200;

export function keepsPosition(offsetY: number | null): boolean {
  return offsetY !== null && offsetY > KEEP_POSITION_FROM;
}

/** Which way the rows slide in: a later month from the right (1), an earlier one from the left (-1), the same one not at all (0). */
export function slideDirection(fromStart: string, toStart: string): 1 | -1 | 0 {
  return toStart > fromStart ? 1 : toStart < fromStart ? -1 : 0;
}

/** How long rows mounted after a month switch still slide in; any mounted later (scrolling) just appear. */
export const ENTER_WINDOW_MS = 450;
/** The slide itself — short enough that tapping through months never waits on it. */
export const ENTER_MS = 220;

/**
 * The list's identity: a new month, or a new sort, is a new list starting at its own top. Reusing
 * the scroll view across months carried the old month's offset (and its refresh state) into the new
 * one, which is the jump.
 */
export function listKey(sortGen: number, periodStart: string | null): string {
  return `sort-${sortGen}-${periodStart ?? "all"}`;
}
