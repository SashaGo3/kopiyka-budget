/**
 * The photo viewer is two screens: the photo (`photo/view`, full screen) and what it says
 * (`photo/read`, a native form sheet over it that leaves the photo usable above it). This is what
 * they share — the photo on screen, which "Replace" on the photo can change, and whether the sheet is
 * up, so leaving takes both away in one go.
 */
import { useSyncExternalStore } from "react";
import { router } from "expo-router";

/** The read sheet's resting heights, as shares of the screen; the photo is laid out above the first. */
export const READ_SHEET_LOW = 0.22;
export const READ_SHEET_DETENTS = [READ_SHEET_LOW, 0.5, 0.92];

let uri: string | null = null;
let sheetUp = false;
const listeners = new Set<() => void>();

/** A viewer opening on a photo: called before its first render, so nothing is told. */
export function openPhoto(first: string): void { uri = first; sheetUp = false; }

export function showPhoto(next: string): void {
  if (next === uri) return;
  uri = next;
  for (const l of listeners) l();
}

export function useShownPhoto(fallback: string): string {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => uri ?? fallback);
}

export function setReadSheetUp(up: boolean): void { sheetUp = up; }

/** Closes the viewer: the sheet and the photo under it, or the photo alone when the sheet is not up. */
export function closePhotoViewer(): void {
  const up = sheetUp;
  sheetUp = false;
  uri = null;
  if (up) router.dismiss(2); else router.back();
}
