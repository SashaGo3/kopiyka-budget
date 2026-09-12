/** First start: the welcome flow runs until an account exists or the user finished/skipped it. */
import { getMeta, listRows, setMeta } from "@kopiyka/core";
import { db } from "@/db";
import { notifyChange } from "@/store";

export function needsOnboarding(): boolean {
  return getMeta(db, "onboarded") !== "1" && listRows(db, "accounts", "deleted=0").length === 0;
}
export function setOnboarded(): void { setMeta(db, "onboarded", "1"); notifyChange(); }
