import { todayLocal } from "@/lib/dates";

/** The moments the cat has a clip for (assets/mascot, scripts/mascot/make-mascot.mjs). */
export type Moment = "hello" | "ready" | "coin" | "salary" | "proud" | "worried" | "sleep" | "debt" | "oops";

type Listener = (moment: Moment) => void;
const listeners = new Set<Listener>();

export function onCheer(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Pops the cat over the current screen (components/Mascot.tsx `MascotToast`). */
export function cheer(moment: Moment): void {
  for (const fn of listeners) fn(moment);
}

let lastCoinDay: string | null = null;

/**
 * After a new entry is saved by hand. The cat is a reward, not a receipt: income gets it every time
 * (it is rare and it is good news), an expense only the first time in a day — logging a coffee for
 * the tenth time should not have a cat jump out at you.
 */
export function cheerNewEntry(kind: "expense" | "income"): void {
  if (kind === "income") return cheer("salary");
  const today = todayLocal();
  if (lastCoinDay === today) return;
  lastCoinDay = today;
  cheer("coin");
}
