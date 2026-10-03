/**
 * First-paint signal. The native launch screen — the silhouette of the Transactions screen
 * (plugins/withSilhouetteLaunchScreen.js) — stays up until the landing screen (Transactions, or
 * Welcome on first run) has committed its first frame and calls `markBooted()`, or a sheet a deep
 * link opened has painted (`markSheetPainted`); it then fades into the real screen. Module state,
 * not React: it only ever flips once. The root layout also calls `markBooted()` after a safety
 * timeout, so a launch that lands somewhere else is never left behind the splash.
 */
import { requireOptionalNativeModule } from "expo-modules-core";
import * as SplashScreen from "expo-splash-screen";

// Before expo-router's own first render would hide it: this module is imported by the root layout.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 250 });
let splashUp = true;
function hideSplash() {
  if (!splashUp) return;
  splashUp = false;
  // A frame later, so what was just committed is on the glass before the splash fades off it.
  requestAnimationFrame(() => SplashScreen.hide());
}

let booted = false;
const listeners = new Set<() => void>();

export const isBooted = () => booted;

export function markBooted() {
  if (booted) return;
  booted = true;
  hideSplash();
  for (const l of listeners) l();
  listeners.clear();
  marks.budgetsPainted = Date.now();
  printTraceOnce();
}

/**
 * Did this launch have somewhere to be — a widget tap, a tapped notification, a Shortcut — rather
 * than being someone opening the app to look at it? Set by the two places a URL is turned into
 * navigation (`+native-intent`, `openDeepLink`). Lives here, with the other facts about this
 * launch, so the early-boot path can set it without importing anything that touches the database.
 */
let launchTarget = false;
export const markLaunchTarget = () => { launchTarget = true; };
export const launchHadTarget = () => launchTarget;

/** Runs `l` once the app has painted; immediately if it already has. Returns an unsubscribe. */
export function onBooted(l: () => void): () => void {
  if (booted) { l(); return () => {}; }
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Cold-launch boot trace (Settings → Diagnostics "Last launch" card): how long it takes from
 * process start to something useful on screen. JS marks below are `Date.now()`; the native ones
 * (process start, "native ready", "JS start") come from KPBridgeModule's `launchTimestamps()`
 * (native/KPBridgeModule.swift) — read once and cached, since they describe a fixed point in this
 * process's history and don't change no matter when this file is asked for them.
 */
type Marks = { appCodeStart?: number; rootLayoutRender?: number; sheetPainted?: number; budgetsPainted?: number };
const marks: Marks = {};

/** Sets a mark the first time it's called; later calls in the same launch are no-ops. */
function once(key: keyof Marks) {
  if (marks[key] === undefined) marks[key] = Date.now();
}

/** Call at the very top of _layout.tsx's module body: the first moment our own code (as opposed to a dependency's) runs. */
export const markAppCodeStart = () => once("appCodeStart");
/** Call on RootLayout's first render. */
export const markRootLayoutRender = () => once("rootLayoutRender");
/** Call once the Log sheet (transaction/[id]) has committed its first frame. */
export function markSheetPainted() {
  once("sheetPainted");
  hideSplash();
  printTraceOnce();
}

type NativeLaunch = { processStart: number; didFinishLaunching: number; jsStart: number };
let nativeLaunch: NativeLaunch | null | undefined;

/** Cached: KPBridgeModule.launchTimestamps() describes a fixed moment and only needs reading once. */
function readNativeLaunch(): NativeLaunch | null {
  if (nativeLaunch !== undefined) return nativeLaunch;
  try {
    const m = requireOptionalNativeModule<{ launchTimestamps?: () => NativeLaunch }>("KPBridge");
    nativeLaunch = m?.launchTimestamps ? m.launchTimestamps() : null;
  } catch {
    nativeLaunch = null;
  }
  return nativeLaunch;
}

export type BootTraceRow = { label: string; atMs: number | null; deltaMs: number | null };

/** One row per stage, each `deltaMs` measured from process start. Missing marks (e.g. the sheet
 * never painted this launch) come back as `null` rows rather than being omitted, so the shape is
 * stable for the Diagnostics card. */
export function bootTrace(): BootTraceRow[] {
  const native = readNativeLaunch();
  const processStart = native?.processStart ?? null;
  const row = (label: string, atMs: number | null | undefined): BootTraceRow => ({
    label, atMs: atMs ?? null,
    deltaMs: processStart != null && atMs != null ? Math.round(atMs - processStart) : null,
  });
  return [
    row("Process start", processStart),
    row("Native ready", native?.didFinishLaunching),
    row("JS start", native?.jsStart),
    row("App code (_layout.tsx)", marks.appCodeStart),
    row("Root layout render", marks.rootLayoutRender),
    row("Log sheet painted", marks.sheetPainted),
    row("Budgets painted", marks.budgetsPainted),
  ];
}

let printed = false;
/** Dev-only, once per launch: whichever of the two terminal marks (sheet or Budgets) lands first
 * prints the trace so far — a moment later so a near-simultaneous second mark is usually caught too. */
function printTraceOnce() {
  if (!__DEV__ || printed) return;
  printed = true;
  setTimeout(() => console.log("[boot] trace", bootTrace()), 30);
}
