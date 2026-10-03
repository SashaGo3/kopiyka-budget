/**
 * JS side of the native bridge (native/KPBridgeModule.swift, an Expo inline module).
 * Widgets, the Apple Watch and App Intents all read the shared SQLite database directly;
 * this bridge only pokes them after JS writes and tells JS when native code wrote.
 */
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { DEFAULT_THEME } from "@kopiyka/core";

/** What the native receipt reader made of a photo (native/KPReceipt.swift). Amounts are major units. */
export interface ReceiptParse {
  merchant: string; total: number; currency: string | null; date: string | null;
  items: { name: string; price: number }[];
  category_id: string | null; category_name: string | null;
  /** Note text: merchant, item count, items with prices, total. */
  summary: string;
  /** "intelligence" (on-device model) or "keywords" (fallback). */
  method: string;
}

/** A write native code (watch, Shortcuts) asks JS to make on its behalf — see native/KPWrites.swift. */
export interface NativeWrite { request: string; op: "addTransaction" | "delete" | "updatePlace" | "suggest" | "payee" | "payment" | "fillIn"; [key: string]: unknown }

type Bridge = {
  reloadWidgets(): void; updateWatch(): Promise<string>; isWatchPaired(): boolean;
  scanReceipt(uri: string): Promise<ReceiptParse>;
  claimDatabase(): void;
  setLanguage(code: string): void;
  setAppIcon(id: string | null): Promise<void>;
  beginThemeTransition(): Promise<boolean>;
  endThemeTransition(duration: number): Promise<void>;
  setWindowBackground(light: string, dark: string): void;
  finishNativeWrite(request: string, ok: boolean, error: string | null, reply: Record<string, unknown>): void;
  addListener(event: "externalChange", cb: () => void): { remove(): void };
  addListener(event: "nativeWrite", cb: (w: NativeWrite) => void): { remove(): void };
};
const native = requireOptionalNativeModule<Bridge>("KPBridge");

/**
 * Tell Swift which language the app is in (native/KPLocale.swift), so the watch, the widgets, the App
 * Intents' answers and the notifications Swift posts follow the app's choice rather than the phone's.
 * A build made before this existed simply keeps following the phone.
 */
export function setNativeLanguage(code: string): void {
  if (typeof native?.setLanguage === "function") { try { native.setLanguage(code); } catch { /* older build */ } }
}

/**
 * Switch the home-screen icon to the one for a colour theme (assets/icons/<id>.png, compiled into the
 * app as "AppIcon-<id>" by plugins/withAppIcons.js). The default theme is the primary icon, so it
 * resets to that. iOS shows its own "You have changed the icon" alert each time; asking for the icon
 * already showing does nothing and shows nothing. No-op off iOS and on a build made before this
 * existed; rejects when iOS refuses (an id with no icon set, or a device without alternate icons).
 */
export async function setAppIcon(themeId: string): Promise<void> {
  if (Platform.OS !== "ios" || typeof native?.setAppIcon !== "function") return;
  await native.setAppIcon(themeId === DEFAULT_THEME ? null : themeId);
}

/**
 * Lay a snapshot of the screen over the app (native/KPBridgeModule.swift, `KPThemeTransition`), so a
 * theme switch can re-mount the tree out of sight. Resolves true once the cover is up; false off iOS,
 * on a build made before this existed, or with no window to cover — the switch then just happens.
 * Native removes the cover by itself after two seconds if `endThemeTransition` never comes.
 */
export async function beginThemeTransition(): Promise<boolean> {
  if (Platform.OS !== "ios" || typeof native?.beginThemeTransition !== "function") return false;
  try { return await native.beginThemeTransition(); } catch { return false; }
}

/** Fade the cover out over `seconds`; resolves when it is gone. No-op where `begin` would be. */
export async function endThemeTransition(seconds = 0.35): Promise<void> {
  if (Platform.OS !== "ios" || typeof native?.endThemeTransition !== "function") return;
  try { await native.endThemeTransition(seconds); } catch { /* the native safety timer removes it */ }
}

/**
 * The theme's background (hex, light and dark side) on the window and root view, so nothing of
 * another palette shows behind a sheet as it slides, or before React has drawn. Follows the phone's
 * appearance natively. No-op off iOS and on older builds.
 */
export function setWindowBackground(light: string, dark: string): void {
  if (Platform.OS !== "ios" || typeof native?.setWindowBackground !== "function") return;
  try { native.setWindowBackground(light, dark); } catch { /* older build */ }
}

export const KPBridge = {
  available: native != null,
  reloadWidgets: () => native?.reloadWidgets(),
  /** Rebuild the watch state from the database and push it (application context, last value wins). */
  updateWatch: () => { void native?.updateWatch(); },
  isWatchPaired: () => native?.isWatchPaired() ?? false,
  /** OCR + on-device understanding of a receipt photo; nothing is saved. */
  scanReceipt: (uri: string): Promise<ReceiptParse> => native ? native.scanReceipt(uri) : Promise.reject(new Error("Receipt scanning needs the native build")),
  /** Fires when a Shortcut, Siri or the watch wrote a transaction directly into the database. */
  onExternalChange(cb: () => void): () => void {
    if (!native) return () => {};
    const sub = native.addListener("externalChange", cb);
    return () => sub.remove();
  },
  /**
   * Tell native code that JS owns the database from now on. Two copies of SQLite live in the app
   * process (expo-sqlite's and the system one Swift links) and cannot see each other's locks, so
   * concurrent writes corrupt the file; after this call native writes arrive as `nativeWrite` events.
   * Must run before the database file is opened.
   */
  claimDatabase: () => { if (typeof native?.claimDatabase === "function") native.claimDatabase(); },   // older native builds lack it
  onNativeWrite(cb: (w: NativeWrite) => void): () => void {
    if (!native) return () => {};
    const sub = native.addListener("nativeWrite", cb);
    return () => sub.remove();
  },
  finishNativeWrite: (request: string, ok: boolean, error: string | null = null, reply: Record<string, unknown> = {}) => {
    if (typeof native?.finishNativeWrite === "function") native.finishNativeWrite(request, ok, error, reply);
  },
};
