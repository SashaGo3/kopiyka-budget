/**
 * JS side of the native bridge (native/KPBridgeModule.swift, an Expo inline module).
 * Widgets, the Apple Watch and App Intents all read the shared SQLite database directly;
 * this bridge only pokes them after JS writes and tells JS when native code wrote.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

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
  finishNativeWrite(request: string, ok: boolean, error: string | null, reply: Record<string, unknown>): void;
  addListener(event: "externalChange", cb: () => void): { remove(): void };
  addListener(event: "nativeWrite", cb: (w: NativeWrite) => void): { remove(): void };
};
const native = requireOptionalNativeModule<Bridge>("KPBridge");

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
