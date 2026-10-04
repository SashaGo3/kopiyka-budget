/**
 * The app's colour theme: which one is chosen, and switching it.
 *
 * The palettes are data in @kopiyka/core (themes.ts); src/constants/theme.ts turns the current one
 * into `C`, `Brand` and `ValueRamp`. This file owns the choice. It lives in `meta` under `theme`, an
 * id from `THEME_IDS` (anything else, or nothing, is the default), and travels in a backup (DATA.md
 * rule 7).
 *
 * A switch re-mounts every screen's *content* and nothing else. Each navigator wraps its screens in
 * `ThemeKeyed` (src/components/ThemeKeyed.tsx, passed as `screenLayout` in every `_layout`), which is
 * keyed on the theme: the content mounts again with every style sheet rebuilt (`themed`) and every
 * memoised colour read afresh, while the navigators stay mounted — the tab that is selected, every
 * stack and every open sheet are untouched, and nothing navigates. What the layouts draw outside a
 * screen (the navigation theme, sheet and tab bar colours) takes the theme as an argument and simply
 * re-renders. A language change is different: it still re-mounts the whole tree (src/app/_layout.tsx).
 *
 * The colours are DynamicColorIOS values baked into those style sheets, so there is nothing to
 * animate in JS. A switch from the picker (`switchTheme`) is a reveal instead: native lays a
 * snapshot of the old screen over the window, the screens re-mount underneath it, and once that has
 * painted the new colours grow over the snapshot from the tap.
 */
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";
import { getMeta, setMeta, themeOf, type ThemeId } from "@kopiyka/core";
import { db } from "@/db";
import { applyThemePalette } from "@/constants/theme";
import { onAfterWrite } from "@/store";
import { beginThemeTransition, endThemeTransition, setWindowBackground } from "@/lib/bridge";

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
onAfterWrite(() => { reloadTheme(); reloadAppearance(); });

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

/** Switch theme. Every screen's content re-mounts in it where it is; nothing navigates. */
export function setTheme(id: ThemeId): void {
  if (themeOf(id).id === current) return;
  setMeta(db, THEME_META_KEY, id);
  reloadTheme();
}

/** How long the new theme takes to grow over the screen from the tap. */
const FADE_SECONDS = 0.5;
/** A tap on the screen, in window points: where the new theme is revealed from. */
export type TapPoint = { x: number; y: number };
/** The longest the cover waits for the re-mounted screens before revealing anyway (native has its own 2 s). */
const MOUNT_TIMEOUT_MS = 1500;
let mounted: (() => void) | null = null;

/**
 * Switch theme from a picker, animated: cover (with a loader at the tap if it is slow) → switch →
 * wait for the re-mounted screens to paint → reveal them in a circle growing from the tap. The app icon is
 * not part of it: it is chosen on its own (AppIconPicker), because iOS answers every icon change
 * with an alert of its own. Safe to call where the cover is not available (off iOS, an older
 * build): the switch then happens without it.
 */
export function switchTheme(id: ThemeId, at?: TapPoint): Promise<void> {
  // One switch at a time. Two quick taps used to overlap: the second laid its cover while the first
  // was still waiting, the first's reveal took the second's cover away mid-mount, and the first then
  // cleared the second's `mounted`. Queued, each one covers, switches and reveals before the next.
  const run = switching.catch(() => {}).then(() => switchOnce(id, at));
  switching = run;
  return run;
}
async function switchOnce(id: ThemeId, at?: TapPoint): Promise<void> {
  if (themeOf(id).id === current) return;
  // A frame for the tick the picker just drew, so the snapshot already shows it.
  await nextFrame();
  const covered = await beginThemeTransition(at);
  let mine: (() => void) | null = null;
  const painted = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, MOUNT_TIMEOUT_MS);
    mine = () => { clearTimeout(timer); resolve(); };
    mounted = mine;
  });
  try { setTheme(id); } finally {
    if (covered) { await painted; await endThemeTransition(FADE_SECONDS); }
    if (mounted === mine) mounted = null;
  }
}

/**
 * `ThemeKeyed`, once the screens it wraps have committed in the new theme. Two frames more — one for
 * the commit to reach native, one for it to be on the glass — and the cover can reveal it. Called by
 * every `ThemeKeyed` on the screen (and by any that merely mounts), so only the first call during a
 * switch counts.
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

/** Re-read the stored choice — after `setTheme`, or a restore that wrote `theme` into meta. */
export function reloadTheme(): void {
  const next = resolve();
  if (next === current) return;
  current = next;
  applyThemePalette(next);
  applyWindowBackground(next);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The forced appearance ("" = the phone's), re-rendering when it changes. */
export function useAppearance(): AppearanceChoice {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}

/**
 * The current theme, re-rendering when it changes. `ThemeKeyed` and the layouts that draw colours
 * outside a screen need this; a screen's content does not — it is re-mounted instead.
 */
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
