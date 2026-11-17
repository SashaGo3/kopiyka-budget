/**
 * What a read receipt puts into an entry, as plain functions (the reading itself is native:
 * apps/mobile/native/KPReceipt.swift). Nothing here writes; the entry sheet decides what to apply.
 */
import { formatMinor, toMinor } from "./money";

export interface ReceiptLike {
  merchant?: string | null;
  address?: string | null;
  total: number;
  currency?: string | null;
  items: { name: string; price: number }[];
}

/**
 * The entry's place from a receipt: the address printed under the shop's name ("ul. Oleska 7,
 * 45-052 Opole") — the shop itself is in the note and the payee — or, with no address, the shop.
 */
export function receiptPlace(r: Pick<ReceiptLike, "merchant" | "address">): string | null {
  return r.address?.trim() || r.merchant?.trim() || null;
}

/** One line per item, "Jabłka — 13,20", in the receipt's currency. */
export function itemLines(items: { name: string; price: number }[], currency: string): string {
  return items.map((i) => `${i.name} — ${formatMinor(toMinor(i.price, currency), currency)}`).join("\n");
}

/** The receipt as a note: the shop, its items, and the total line the caller words (`totalLine`). */
export function receiptBlock(r: ReceiptLike, fallbackCurrency: string, totalLine: (amount: string) => string): string {
  const cur = r.currency ?? fallbackCurrency;
  const lines = [r.merchant?.trim(), itemLines(r.items, cur)];
  if (r.total > 0) lines.push(totalLine(`${formatMinor(toMinor(r.total, cur), cur)} ${cur}`));
  return lines.filter(Boolean).join("\n");
}

/** `note` with `block` under it — never over what was written — and unchanged when it is there already. */
export function appendBlock(note: string, block: string): string {
  if (!block || note.includes(block)) return note;
  return note.trim() ? `${note.trimEnd()}\n\n${block}` : block;
}

/**
 * A day short enough for a chip a quarter of the screen wide, weekday included: "Tue 14 Nov" this
 * year, "Tue 14.08.18" another. ("вт, 14 серп. 2018" was cut off.)
 */
export function compactDayLabel(day: string, locale: string, now = new Date()): string {
  const d = new Date(day.slice(0, 10) + "T12:00:00");
  const weekday = d.toLocaleDateString(locale, { weekday: "short" }).replace(/\.$/, "");
  const date = d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString(locale, { day: "numeric", month: "short" })
    : d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "2-digit" });
  return `${weekday} ${date}`;
}

/**
 * Where a dragged sheet comes to rest: the nearest of `points` (heights, smallest first), unless it
 * was flung — then the next one in the direction of the fling. `velocity` is upward-positive, in
 * points per millisecond as PanResponder reports it.
 */
export function snapIndex(points: number[], height: number, velocity: number): number {
  let nearest = 0;
  points.forEach((p, i) => { if (Math.abs(p - height) < Math.abs(points[nearest]! - height)) nearest = i; });
  if (Math.abs(velocity) < 0.5) return nearest;
  const below = points.reduce((acc, p, i) => (p <= height ? i : acc), 0);
  const above = points.findIndex((p) => p >= height);
  return velocity > 0 ? (above === -1 ? points.length - 1 : above) : below;
}
