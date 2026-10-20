/**
 * The words a transaction row is titled and subtitled with. Your note names the row; what the
 * payment itself says — the shop (`payee`) and the bank's notification text (`bank_note`, DATA.md
 * rule 20) — goes underneath. With no note of yours, the payment's own words take the title.
 *
 * Nothing is said twice: when the bank's text already starts with the shop ("WROCLAWSKIE
 * PRZEDSIEBI, WROCLAW" for "WROCLAWSKIE PRZEDSIEBI"), that line stands for both, and a note that is
 * just the shop's name (older entries were seeded that way) counts as no note at all.
 */
export interface RowText {
  /** The title's text, or null when neither you nor the payment said anything (callers fall back to the category). */
  title: string | null;
  /** The rest of your note under the title, at most two lines. */
  noteSub: string | null;
  /** The payment's own words under it, at most two lines. */
  detailSub: string | null;
}

const lines = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

/** The shop, then the bank's text — or the bank's text alone when a line of it already starts with the shop. */
export function paymentDetails(tx: { payee?: string | null; bank_note?: string | null }): string[] {
  const bank = lines(tx.bank_note);
  const payee = tx.payee?.trim();
  if (!payee) return bank;
  const lp = payee.toLocaleLowerCase();
  return bank.some((l) => l.toLocaleLowerCase().startsWith(lp)) ? bank : [payee, ...bank];
}

export function rowText(tx: { payee?: string | null; notes?: string | null; bank_note?: string | null }): RowText {
  const noteText = tx.notes?.trim();
  const note = noteText && noteText !== tx.payee?.trim() ? lines(noteText) : [];
  const details = paymentDetails(tx);
  const two = (l: string[]) => l.slice(0, 2).join("\n") || null;
  if (note.length) return { title: note[0]!, noteSub: two(note.slice(1)), detailSub: two(details) };
  return { title: details[0] ?? null, noteSub: null, detailSub: two(details.slice(1)) };
}
