/**
 * One receipt, several things: the Lidl trip that was mostly food and one lamp.
 *
 * A split writes an ordinary transaction per part instead of filing the whole sum under whichever
 * category was the biggest lie. Nothing links the parts to each other and nothing needs to — each
 * one is simply the entry for what it says it is, and behaves like any other entry afterwards.
 *
 * The entry the user typed is the **first** part and keeps whatever is left over. That is why the
 * keypad total never changes as parts are carved off it: the total is the receipt, and the first
 * part is "the rest of the shop". It is also what keeps the arithmetic honest — the parts add up to
 * the total exactly, with no rounding dust to lose or invent.
 */

/** A part of a split. `amount_minor` is a magnitude in minor units, always positive. */
export interface SplitPart {
  amount_minor: number;
  category_id: string | null;
  tag_ids: string[];
}

/**
 * What each part of a split is worth, the entry's own share first, in minor units and positive.
 *
 * `null` when the numbers do not describe a split at all: a part that is not a positive whole
 * number of minor units, or parts that leave the entry itself nothing (or less than nothing). A
 * split has to have something in every part, including the one the user started with.
 */
export function splitAmounts(totalMinor: number, partMinors: number[]): number[] | null {
  const total = Math.abs(Math.trunc(totalMinor));
  if (!total || !partMinors.length) return null;
  let rest = total;
  for (const part of partMinors) {
    if (!Number.isInteger(part) || part <= 0) return null;
    rest -= part;
  }
  return rest > 0 ? [rest, ...partMinors] : null;
}

/**
 * The foreign original shared out in the same proportions (rule 6: what the bank actually charged
 * is kept beside the converted amount, so the conversion can be checked later). The entry's own
 * part — the first one, the remainder — takes the rounding, so the shares add back up to the
 * charge to the minor unit rather than drifting a cent away from it.
 *
 * The sign of the original is kept: an expense charged abroad stays negative in both columns.
 */
export function shareEntered(enteredTotal: number, amounts: number[]): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (!total) return amounts.map(() => 0);
  const sign = enteredTotal < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(enteredTotal));
  const shares = amounts.map((a) => Math.round((abs * a) / total));
  shares[0] = (shares[0] ?? 0) + (abs - shares.reduce((a, b) => a + b, 0));
  return shares.map((s) => s * sign);
}
