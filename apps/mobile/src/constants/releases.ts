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
 */
export const RELEASES: Release[] = [
  {
    // 1.0.1 does not exist: it was skipped on 2026-09-21 rather than submitted, so this entry
    // covers everything since 1.0.0 — which is what a TestFlight tester on build 28 actually sees.
    version: "1.0.2",
    date: "2026-09-21",
    added: [
      "Split one shop into the several things it sold you — dinner and a lamp on one receipt become two entries that still add up.",
      "Mark how much each category matters to you: Settings → Categories → Set what matters asks two questions and works out the rest.",
      "Three new insight cards — what the month went on by how much each category matters, what is safe to spend once everything still due is taken off, and how many months of essentials an account would cover.",
      "One budget can now cover several categories, and a budget can be suggested from a year or from your whole history.",
      "Returns: money that came back is booked against what you spent rather than logged as income.",
      "A category can be turned into a tag, and a tag into a category.",
      "Edit many transactions at once, and see exactly what will change before it does.",
      "Money the bank has only blocked is logged too, not just money it has taken.",
      "Twice as many category icons, with words to find them by.",
    ],
    improved: [
      "Permissions are asked for where the feature is, never on a screen you can dismiss first.",
      "A transfer names both accounts and shows both balances.",
      "A budget shows its categories as a stack of their own icons, and the Spending section has a total.",
      "Tapping a category or a tag opens its transactions on the Transactions tab.",
      "A tapped reminder goes to what it is about.",
      "The entry sheet: a note opens at its first line, chips that need an amount are dimmed rather than explained after the tap, and the save button has its room back.",
      "The notification automation asks the shop's name before asking what is within 80 metres.",
    ],
    fixed: [
      "BLIK is recorded as how you paid, not who you paid to.",
      "The town the bank printed no longer becomes the entry's location.",
      "Money held in another currency is counted in the month's totals, and a total is only marked approximate when that total was actually converted.",
      "Pending and recurring-due amounts agree with their counts.",
      "A budget prints the amount it is about rather than the limit.",
      "When a shop has been filed two ways, the app asks which it was.",
      "The database is re-read when the app comes back, so an entry written while it was away shows up.",
    ],
  },
];
