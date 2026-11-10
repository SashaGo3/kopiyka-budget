/**
 * One Undo at a time, for actions that used to stop and ask first ("Delete this entry?").
 *
 * Asking before every delete trains a tap through the question; offering the way back afterwards
 * costs nothing when the delete was meant and saves the day when it was not. A delete is a
 * tombstone (DATA.md rule 8), so undoing it is writing the row back — nothing is lost meanwhile.
 *
 * `commit` is what may only happen once the chance to undo has passed — a receipt photo is deleted
 * from disk then, not when the row goes (lib/photos.ts). A newer offer commits the one before it.
 */
export interface UndoOffer { label: string; undo: () => void; commit?: () => void }

let current: (UndoOffer & { id: number }) | null = null;
let seq = 0;
const listeners = new Set<(o: (UndoOffer & { id: number }) | null) => void>();
const emit = () => { for (const l of listeners) l(current); };

export function offerUndo(o: UndoOffer): void {
  current?.commit?.();
  current = { ...o, id: ++seq };
  emit();
}

/** The toast timed out or was swiped away: the action stands. */
export function settleUndo(id: number): void {
  if (current?.id !== id) return;
  current.commit?.();
  current = null;
  emit();
}

/** Undo was tapped: put things back, and the commit never runs. */
export function takeUndo(id: number): void {
  if (current?.id !== id) return;
  const o = current;
  current = null;
  emit();
  o.undo();
}

export function onUndoOffer(l: (o: (UndoOffer & { id: number }) | null) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
