import type { SqlDriver } from "./db";

/**
 * What an empty Transactions list offers to do about being empty.
 *
 * Its one button used to be "Show everything" whatever the reason, and on the month you are in, with
 * every account and no filter, "everything" is exactly what was already on screen — a button that did
 * nothing. So the button names what it will actually change, and is left out when nothing would:
 *
 * - `reset`   — filters, an account scope or a search narrow the list: clear them;
 * - `current` — another month is open and simply has nothing in it: back to this one;
 * - `earlier` — this month has nothing yet, but an earlier one does: open the latest of those;
 * - `none`    — nothing to undo and nowhere else to look.
 */
export type EmptyListAction =
  | { kind: "reset" }
  | { kind: "current" }
  | { kind: "earlier"; day: string }
  | { kind: "none" };

export function emptyListAction(s: {
  /** Filter-sheet answers in force (search text included). */
  filters: number;
  /** An account scope narrows the list. */
  scoped: boolean;
  /** The open month is the one today is in. */
  isCurrent: boolean;
  /** The newest day with a transaction before the open month (`latestDayBefore`), or null. */
  earlierDay: string | null;
}): EmptyListAction {
  if (s.filters > 0 || s.scoped) return { kind: "reset" };
  if (!s.isCurrent) return { kind: "current" };
  if (s.earlierDay) return { kind: "earlier", day: s.earlierDay };
  return { kind: "none" };
}

/**
 * The newest day (YYYY-MM-DD) before `before` that has a transaction on any of `accountIds` (empty =
 * every account), or null. Deleted rows do not count; pending ones do, since the list shows them.
 */
export function latestDayBefore(db: SqlDriver, before: string, accountIds: readonly string[] = []): string | null {
  const scoped = accountIds.length ? ` AND account_id IN (${accountIds.map(() => "?").join(",")})` : "";
  const row = db.get<{ d: string | null }>(
    `SELECT MAX(substr(date, 1, 10)) AS d FROM transactions WHERE deleted=0 AND substr(date, 1, 10) < ?${scoped}`,
    [before, ...accountIds]);
  return row?.d ?? null;
}
