import type { Release } from "@kopiyka/core";

/**
 * What changed, in the user's words. Newest first; `version` must match `app.json` exactly, or the
 * entry is never shown (`releasesSince` compares against the running build).
 *
 * Three lists, and the split is the point: **Added** is something that was not there, **Improved**
 * is something that was there and is now better, **Fixed** is something that was wrong. A line that
 * does not obviously belong to one of the three is usually a line nobody needed to read.
 *
 * Write for someone who does not know the app's internals: "a transfer now shows both balances",
 * not "TransferRow renders both legs". Keep each release to a handful of lines — a changelog nobody
 * finishes is a changelog nobody reads. A release with nothing worth saying gets no entry at all
 * rather than an empty one.
 *
 * Give each line an `icon` (an SF Symbol) that says what the line is about at a glance; a bare
 * string still works and is drawn with a plain bullet.
 */
// 1.0.2 is the first App Store release, so it has nothing to be "new" against: its notes were
// dropped on 2026-09-28. The next version's entry goes here.
export const RELEASES: Release[] = [];
