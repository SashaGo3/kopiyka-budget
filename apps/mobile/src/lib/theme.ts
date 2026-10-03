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
 *
 * The colours are DynamicColorIOS values baked into those style sheets, so there is nothing to
 * animate in JS. A switch from the picker (`switchTheme`) is a cross-fade instead: native lays a
 * snapshot of the old screen over the window, the tree re-mounts underneath it and is put back on
 * the picker in one step (the navigation state captured here, restored by the root layout before the
 * navigator mounts — so no push animates), and once that has painted the snapshot fades away.
 */
import { useSyncExternalStore } from "react";
import { getMeta, setMeta, themeOf, type ThemeId } from "@kopiyka/core";
import { db } from "@/db";
import { applyThemePalette } from "@/constants/theme";
import { onAfterWrite } from "@/store";
import { beginThemeTransition, endThemeTransition, setAppIcon, setWindowBackground } from "@/lib/bridge";

export const THEME_META_KEY = "theme";

let current: ThemeId = resolve();
applyThemePalette(current);
applyWindowBackground(current);
/** The routes a theme is picked on, which the re-mounted app goes back to. */
export type ThemePickerRoute = "/settings/theme" | "/onboarding/theme";
/** A navigation state as the container reports it — only the shape `partialState` walks. */
export type NavState = { index?: number; routes: { name: string; params?: object; state?: NavState }[] };
/** Where to go back to after the re-mount: the picker, and the whole navigation state it was on. */
export type ThemeReturn = { route: ThemePickerRoute; state: NavState | null };
let returnTo: ThemeReturn | null = null;
let readNavigation: (() => NavState | undefined) | null = null;
const listeners = new Set<() => void>();

function resolve(): ThemeId {
  let stored: string | null = null;
  try { stored = getMeta(db, THEME_META_KEY); } catch { /* a fresh database: the default */ }
  return themeOf(stored).id;
}

// A restore can carry a `theme` setting (DATA.md rule 7); whichever path wrote it, take it up.
onAfterWrite(() => reloadTheme());

export function getTheme(): ThemeId { return current; }

/** The root layout hands over how to read the navigation state, so a switch can capture it first. */
export function registerThemeNavigation(read: () => NavState | undefined): void { readNavigation = read; }

/**
 * Switch theme. The tree re-mounts in it; `from` is the route to come back to afterwards (the picker
 * that was tapped), otherwise the root layout goes to Settings, as it does for a language.
 */
export function setTheme(id: ThemeId, from?: ThemePickerRoute): void {
  if (themeOf(id).id === current) return;
  setMeta(db, THEME_META_KEY, id);
  let state: NavState | null = null;
  if (from) { try { state = partialState(readNavigation?.()) ?? null; } catch { /* go by the route */ } }
  returnTo = from ? { route: from, state } : null;
  reloadTheme();
}

/** How long the old screen takes to fade off the new one. */
const FADE_SECONDS = 0.35;
/** The longest the cover waits for the new tree before fading anyway (native has its own 2 s). */
const MOUNT_TIMEOUT_MS = 1500;
let mounted: (() => void) | null = null;

/**
 * Switch theme from a picker, animated: cover → switch → wait for the new tree to paint → fade. The
 * app icon follows only after the fade, because iOS answers it with an alert of its own and that
 * should not land on top of a screen still changing colour. Safe to call where the cover is not
 * available (off iOS, an older build): the switch then happens without it.
 */
export async function switchTheme(id: ThemeId, from: ThemePickerRoute): Promise<void> {
  if (themeOf(id).id === current) return;
  // A frame for the tick the picker just drew, so the snapshot already shows it.
  await nextFrame();
  const covered = await beginThemeTransition();
  const painted = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, MOUNT_TIMEOUT_MS);
    mounted = () => { clearTimeout(timer); resolve(); };
  });
  try { setTheme(id, from); } finally {
    if (covered) { await painted; await endThemeTransition(FADE_SECONDS); }
    mounted = null;
  }
  setAppIcon(id).catch(() => { /* an older build, or iOS refused: the colours still change */ });
}

/** The root layout, once the re-mounted tree is back where it belongs and has painted. */
export function themeMounted(): void { mounted?.(); }

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * The navigation state with everything a navigator fills in for itself taken off — keys, `stale`,
 * route name lists, history — so a freshly mounted navigator rehydrates it as its initial state
 * rather than checking it against keys that died with the old tree.
 */
function partialState(state: NavState | undefined): NavState | undefined {
  if (!state?.routes?.length) return undefined;
  return {
    index: state.index,
    routes: state.routes.map((r) => ({
      name: r.name,
      ...(r.params ? { params: r.params } : null),
      ...(r.state ? { state: partialState(r.state) } : null),
    })),
  };
}

/** The window behind everything React draws takes the theme's background, light and dark. */
function applyWindowBackground(id: ThemeId): void {
  const t = themeOf(id);
  setWindowBackground(t.light.bg, t.dark.bg);
}

/** Re-read the stored choice — after `setTheme`, or a restore that wrote `theme` into meta. */
export function reloadTheme(): void {
  const next = resolve();
  if (next === current) return;
  current = next;
  applyThemePalette(next);
  applyWindowBackground(next);
  for (const l of listeners) l();
}

/** Where the root layout should go after a theme change, once: the picker that made it, if any. */
export function takeThemeReturn(): ThemeReturn | null {
  const r = returnTo;
  returnTo = null;
  return r;
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The current theme, re-rendering when it changes. Only the root layout and the picker need this. */
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
