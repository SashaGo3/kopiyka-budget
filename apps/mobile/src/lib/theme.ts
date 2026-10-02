/**
 * The app's colour theme: which one is chosen, and switching it.
 *
 * The palettes are data in @kopiyka/core (themes.ts); src/constants/theme.ts turns the current one
 * into `C`, `Brand` and `ValueRamp`. This file owns the choice. It lives in `meta` under `theme`, an
 * id from `THEME_IDS` (anything else, or nothing, is the default), and travels in a backup (DATA.md
 * rule 7).
 *
 * A switch is the same as a switch of language (src/i18n): nothing re-renders in place. The root
 * layout is keyed on the theme as well as the language, so the whole tree mounts again with every
 * style sheet rebuilt (`themed`) and every memoised colour read afresh, and then goes back to where
 * the theme was picked (`takeThemeReturn`).
 */
import { useSyncExternalStore } from "react";
import { getMeta, setMeta, themeOf, type ThemeId } from "@kopiyka/core";
import { db } from "@/db";
import { applyThemePalette } from "@/constants/theme";
import { onAfterWrite } from "@/store";

export const THEME_META_KEY = "theme";

let current: ThemeId = resolve();
applyThemePalette(current);
/** The routes a theme is picked on, which the re-mounted app goes back to. */
export type ThemePickerRoute = "/settings/theme" | "/onboarding/theme";
let returnTo: ThemePickerRoute | null = null;
const listeners = new Set<() => void>();

function resolve(): ThemeId {
  let stored: string | null = null;
  try { stored = getMeta(db, THEME_META_KEY); } catch { /* a fresh database: the default */ }
  return themeOf(stored).id;
}

// A restore can carry a `theme` setting (DATA.md rule 7); whichever path wrote it, take it up.
onAfterWrite(() => reloadTheme());

export function getTheme(): ThemeId { return current; }

/**
 * Switch theme. The tree re-mounts in it; `from` is the route to come back to afterwards (the picker
 * that was tapped), otherwise the root layout goes to Settings, as it does for a language.
 */
export function setTheme(id: ThemeId, from?: ThemePickerRoute): void {
  if (themeOf(id).id === current) return;
  setMeta(db, THEME_META_KEY, id);
  returnTo = from ?? null;
  reloadTheme();
}

/** Re-read the stored choice — after `setTheme`, or a restore that wrote `theme` into meta. */
export function reloadTheme(): void {
  const next = resolve();
  if (next === current) return;
  current = next;
  applyThemePalette(next);
  for (const l of listeners) l();
}

/** Where the root layout should go after a theme change, once: the picker that made it, if any. */
export function takeThemeReturn(): ThemePickerRoute | null {
  const r = returnTo;
  returnTo = null;
  return r;
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The current theme, re-rendering when it changes. Only the root layout and the picker need this. */
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
