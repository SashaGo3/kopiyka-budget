/**
 * The two figures of a transfer on the transfer sheet: what leaves one account and what reaches the
 * other. Either can be typed; the rule is that a figure the person typed is never recalculated.
 *
 * - Neither typed: nothing to show.
 * - One typed: the other follows it at `rate` (destination units per source unit; 1 for one
 *   currency), or stays unknown (null) when there is no rate — never invented.
 * - Both typed: both stand exactly as typed. A bank's own conversion, or a fee taken on the way, is
 *   the truth of what happened, and a rate the app fetched has no business overruling it.
 */
export type Side = "from" | "to";

export function deriveTransfer(o: { from: number | null; to: number | null; typed: Record<Side, boolean>; rate: number | null }): { from: number | null; to: number | null } {
  const from = o.typed.from ? o.from : null;
  const to = o.typed.to ? o.to : null;
  const ok = o.rate !== null && Number.isFinite(o.rate) && o.rate > 0;
  if (o.typed.from && o.typed.to) return { from, to };
  if (o.typed.from) return { from, to: from !== null && ok ? round2(from * o.rate!) : null };
  if (o.typed.to) return { from: to !== null && ok ? round2(to / o.rate!) : null, to };
  return { from: null, to: null };
}

/** To the cent, as the sheet shows money (toMinor rounds again for currencies without cents). */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
