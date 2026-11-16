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
  /**
   * A friend's share rather than a part of your own (people.ts): written with their `person_id`, no
   * category and no tags, because it is not your spending. Absent or null for an ordinary part.
   */
  person_id?: string | null;
  /** What a friend's share was for. Only on a part with a person. */
  items?: import("./models").ShareItem[];
  /**
   * The part's own note ("the lamp"), written in place of the entry's. Absent or empty: the part
   * shares the entry's note, as every part did before notes could be given here.
   */
  note?: string | null;
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

/**
 * A receipt's items sorted into categories, turned into the split they describe: the dinner and the
 * lamp on one bill. Items nobody sorted, and those sorted into the entry's own category, stay with
 * the entry; each other category becomes a part of its own. When everything was sorted and none of
 * it into the entry's category, the biggest group becomes the entry's (so the entry is re-filed
 * rather than left with nothing).
 *
 * Prices are what the receipt printed, in whatever currency it printed them; they are only
 * proportions here. Each part is its share of `totalMinor` — the amount actually on the entry, so a
 * converted or rounded payment splits the same way — measured against the receipt's total or the
 * items' sum, whichever is larger (a discount line the reader skipped can make the items add up to
 * more). The entry keeps the remainder, so the parts and the entry always add up exactly
 * (`splitAmounts`). A part that would round to nothing is left with the entry.
 */
export function receiptSplit(
  items: { price: number; category_id: string | null }[],
  receiptTotal: number,
  totalMinor: number,
  entryCategory: string | null,
): { category_id: string | null; parts: { category_id: string; amount_minor: number }[] } {
  const total = Math.abs(totalMinor);
  const sums = new Map<string | null, number>();
  for (const it of items) if (it.price > 0) sums.set(it.category_id, (sums.get(it.category_id) ?? 0) + it.price);
  const all = [...sums.values()].reduce((a, b) => a + b, 0);
  const basis = Math.max(receiptTotal > 0 ? receiptTotal : 0, all);
  if (!basis || !total) return { category_id: entryCategory, parts: [] };
  let main = entryCategory;
  if (!sums.has(null) && !(entryCategory && sums.has(entryCategory)) && sums.size) {
    main = [...sums.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  const parts: { category_id: string; amount_minor: number }[] = [];
  for (const [cat, sum] of sums) {
    if (cat === null || cat === main) continue;
    const minor = Math.round((sum / basis) * total);
    if (minor > 0) parts.push({ category_id: cat, amount_minor: minor });
  }
  parts.sort((a, b) => b.amount_minor - a.amount_minor);
  // Rounding can never take the entry's own share to nothing unless it had none; drop the smallest
  // parts until something is left, rather than offer a split `splitAmounts` would refuse.
  while (parts.length && parts.reduce((a, p) => a + p.amount_minor, 0) >= total) parts.pop();
  return { category_id: main, parts };
}
