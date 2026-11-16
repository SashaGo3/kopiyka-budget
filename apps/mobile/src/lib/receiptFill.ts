/**
 * What a read receipt puts into an entry's note: the shop, one line per item, the total — the
 * content of the receipt, so it can be searched and read later without opening the photo. It goes
 * *under* whatever the person already wrote, never over it, and is not added twice.
 */
import { formatMinor, toMinor } from "@kopiyka/core";
import type { ReceiptParse } from "@/lib/bridge";
import { t } from "@/i18n";

export function receiptNote(r: ReceiptParse, fallbackCurrency: string): string {
  const cur = r.currency ?? fallbackCurrency;
  const money = (major: number) => formatMinor(toMinor(major, cur), cur);
  const lines = [r.merchant?.trim(), ...r.items.map((i) => `${i.name} — ${money(i.price)}`)];
  if (r.total > 0) lines.push(t("photo.read.noteTotal", { amount: `${money(r.total)} ${cur}` }));
  return lines.filter(Boolean).join("\n");
}

/** `note` with the receipt's content below it; unchanged when it is already there. */
export function noteWithReceipt(note: string, r: ReceiptParse, fallbackCurrency: string): string {
  const add = receiptNote(r, fallbackCurrency);
  if (!add || note.includes(add)) return note;
  return note.trim() ? `${note.trimEnd()}\n\n${add}` : add;
}

/** The lines of some of a receipt's items, for the note of the split part they became. */
export function itemsNote(items: { name: string; price: number }[], currency: string): string {
  return items.map((i) => `${i.name} — ${formatMinor(toMinor(i.price, currency), currency)}`).join("\n");
}
