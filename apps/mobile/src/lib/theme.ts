/**
 * The app's colour theme: which one is chosen, and switching it.
 *
 * The palettes are data in @kopiyka/core (themes.ts); src/constants/theme.ts turns the current one
 * into `C`, `Brand` and `ValueRamp`. This file owns the choice. It lives in `meta` under `theme`, an
 * id from `THEME_IDS` (anything else, or nothing, is the default), and travels in a backup (DATA.md
 * rule 7).
 *
 * On iOS a switch re-mounts nothing and re-renders nothing: every colour on screen is a named native
 * colour (src/constants/theme.ts, native/KPThemeColors.swift) and native simply resolves them in the
 * new theme, exactly as it does for the phone's light/dark switch. The tab, every stack, every open
 * sheet, every half-typed field and every scroll position stay as they were. What the layouts draw
 * themselves (the navigation theme, sheet and tab bar colours) takes the theme as an argument and
 * re-renders in place. Earlier builds re-mounted each screen's content instead, and now and then a
 * screen came back empty; that path is gone.
 *
 * Where named colours are unavailable (off iOS, `NAMED_COLORS` false) the root layout re-mounts the
 * whole tree on a switch, as it does for a language change (src/app/_layout.tsx).
 *
 * A switch from the picker (`switchTheme`) is a reveal: native lays a snapshot of the old screen over
 * the window, the colours change underneath it, and the new ones grow over the snapshot from the tap.
 */
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";
import { getMeta, setMeta, themeOf, type ThemeId } from "@kopiyka/core";
import { db } from "@/db";
import { NAMED_COLORS, applyThemePalette } from "@/constants/theme";
import { onAfterWrite } from "@/store";
import { beginThemeTransition, endThemeTransition, setThemeColors, setWindowBackground } from "@/lib/bridge";

export const THEME_META_KEY = "theme";
/**
 * Light or dark regardless of the phone, or "" to follow it. Stored beside the theme and travelling
 * with it (DATA.md rule 7). Applied natively (`Appearance.setColorScheme` sets the windows'
 * `overrideUserInterfaceStyle`), so every DynamicColorIOS — and native headers, sheets, the keyboard —
 * resolves to the chosen side without anything re-mounting.
 */
export const APPEARANCE_META_KEY = "appearance";
export type AppearanceChoice = "" | "light" | "dark";

let current: ThemeId = resolve();
applyThemePalette(current);
void setThemeColors(current, false);
applyWindowBackground(current);
let appearance: AppearanceChoice = resolveAppearance();
Appearance.setColorScheme(appearance || "unspecified");
const listeners = new Set<() => void>();

function resolve(): ThemeId {
  let stored: string | null = null;
  try { stored = getMeta(db, THEME_META_KEY); } catch { /* a fresh database: the default */ }
  return themeOf(stored).id;
}

function resolveAppearance(): AppearanceChoice {
  let stored: string | null = null;
  try { stored = getMeta(db, APPEARANCE_META_KEY); } catch { /* a fresh database: follow the phone */ }
  return stored === "light" || stored === "dark" ? stored : "";
}

// A restore can carry `theme` and `appearance` settings (DATA.md rule 7); whichever path wrote them, take them up.
onAfterWrite(() => { void reloadTheme(); reloadAppearance(); });

/** The cover-and-reveal switch in progress, if any; the next one waits for it. */
let switching: Promise<void> = Promise.resolve();

export function getAppearance(): AppearanceChoice { return appearance; }

function reloadAppearance(): void {
  const next = resolveAppearance();
  if (next === appearance) return;
  appearance = next;
  Appearance.setColorScheme(next || "unspecified");
  for (const l of listeners) l();
}

/**
 * Force light or dark, or follow the phone again (""). Cross-faded like a theme switch, but nothing
 * re-mounts: the colours resolve to the other side natively, so two frames are enough to wait.
 */
export function switchAppearance(next: AppearanceChoice, at?: TapPoint): Promise<void> {
  // Queued behind any theme switch still running: both lay the same cover (see `switchTheme`).
  const run = switching.catch(() => {}).then(() => appearanceOnce(next, at));
  switching = run;
  return run;
}

async function appearanceOnce(next: AppearanceChoice, at?: TapPoint): Promise<void> {
  if (next === appearance) return;
  await nextFrame();
  const covered = await beginThemeTransition(at);
  try {
    setMeta(db, APPEARANCE_META_KEY, next);
    reloadAppearance();
    await nextFrame(); await nextFrame();
  } finally {
    if (covered) await endThemeTransition(FADE_SECONDS);
  }
}

export function getTheme(): ThemeId { return current; }

/** Switch theme, in place; nothing navigates. Resolves once the new colours are on screen (or applied). */
export function setTheme(id: ThemeId): Promise<void> {
  if (themeOf(id).id === current) return Promise.resolve();
  setMeta(db, THEME_META_KEY, id);
  return reloadTheme();
}

/** How long the new theme takes to grow over the screen from the tap. */
const FADE_SECONDS = 0.5;
/** A tap on the screen, in window points: where the new theme is revealed from. */
export type TapPoint = { x: number; y: number };
/** The longest the cover waits for the tree to re-mount (fallback path only; native has its own 2 s). */
const MOUNT_TIMEOUT_MS = 1500;
let mounted: (() => void) | null = null;

/**
 * Switch theme from a picker, animated: cover (with a loader at the tap if it is slow) → switch →
 * wait for the new colours to be on the glass → reveal them in a circle growing from the tap. The
 * app icon is not part of it: it is chosen on its own (AppIconPicker), because iOS answers every icon
 * change with an alert of its own. Safe to call where the cover is not available: the switch then
 * happens without it.
 */
export function switchTheme(id: ThemeId, at?: TapPoint): Promise<void> {
  // One switch at a time: each one covers, switches and reveals before the next begins.
  const run = switching.catch(() => {}).then(() => switchOnce(id, at));
  switching = run;
  return run;
}
async function switchOnce(id: ThemeId, at?: TapPoint): Promise<void> {
  if (themeOf(id).id === current) return;
  // A frame for the tick the picker just drew, so the snapshot already shows it.
  await nextFrame();
  const covered = await beginThemeTransition(at);
  try {
    if (NAMED_COLORS) {
      await setTheme(id);
      // One frame for the re-resolved layers to commit, one for them to reach the glass.
      await nextFrame(); await nextFrame();
    } else {
      let mine: (() => void) | null = null;
      const painted = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, MOUNT_TIMEOUT_MS);
        mine = () => { clearTimeout(timer); resolve(); };
        mounted = mine;
      });
      try { await setTheme(id); await painted; } finally { if (mounted === mine) mounted = null; }
    }
  } finally {
    if (covered) await endThemeTransition(FADE_SECONDS);
  }
}

/**
 * Fallback path only: the root layout, once the tree it re-mounted for a new theme has committed. Two
 * frames more — one for the commit to reach native, one for it to be on the glass — and the cover
 * can reveal it.
 */
export function themeMounted(): void {
  const done = mounted;
  if (!done) return;
  mounted = null;
  void nextFrame().then(nextFrame).then(done);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The window behind everything React draws takes the theme's background, light and dark. */
function applyWindowBackground(id: ThemeId): void {
  const t = themeOf(id);
  setWindowBackground(t.light.bg, t.dark.bg);
}

/**
 * Re-read the stored choice — after `setTheme`, or a restore that wrote `theme` into meta. Native
 * re-resolves the named colours; listeners (the layouts, and the root's re-mount on the fallback
 * path) hear of it. Resolves once native has done its part.
 */
export function reloadTheme(): Promise<void> {
  const next = resolve();
  if (next === current) return Promise.resolve();
  current = next;
  applyThemePalette(next);
  applyWindowBackground(next);
  const done = setThemeColors(next, true);
  for (const l of listeners) l();
  return done;
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The forced appearance ("" = the phone's), re-rendering when it changes. */
export function useAppearance(): AppearanceChoice {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}

/**
 * The current theme, re-rendering when it changes. Only what draws plain colours needs it — the
 * layouts, the glass tint, a label naming the theme; anything coloured through `C` follows natively.
 */
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
