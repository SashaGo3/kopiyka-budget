/**
 * What a read receipt puts into an entry's note: the shop, one line per item, the total — the
 * content of the receipt, so it can be searched and read later without opening the photo. It goes
 * *under* whatever the person already wrote, never over it, and is not added twice. The logic is
 * core's (receipt.ts, tested there); this only supplies the words.
 */
import { appendBlock, itemLines, receiptBlock } from "@kopiyka/core";
import type { ReceiptParse } from "@/lib/bridge";
import { t } from "@/i18n";

export function receiptNote(r: ReceiptParse, fallbackCurrency: string): string {
  return receiptBlock(r, fallbackCurrency, (amount) => t("photo.read.noteTotal", { amount }));
}

/** `note` with the receipt's content below it; unchanged when it is already there. */
export function noteWithReceipt(note: string, r: ReceiptParse, fallbackCurrency: string): string {
  return appendBlock(note, receiptNote(r, fallbackCurrency));
}

/** The lines of some of a receipt's items, for the note of the split part they became. */
export const itemsNote = itemLines;
