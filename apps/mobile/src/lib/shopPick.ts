/**
 * What the category picker needs to offer "Filed here before": the shop's name and the row asking,
 * so the row's own category (filled in from history, or guessed) is not counted as an answer.
 */
export function shopParams(payee: string | null | undefined, note: string | null | undefined, except?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (payee?.trim()) out.payee = payee.trim();
  if (note?.trim()) out.note = note.trim();
  if (out.payee || out.note) { if (except) out.except = except; }
  return out;
}
