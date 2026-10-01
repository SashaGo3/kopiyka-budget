/**
 * Three things only the device can answer — the pasteboard, the languages and region iOS is set to,
 * and Apple's map search. Native side: native/KPDevice.swift, reached through the same inline
 * module as the rest of the bridge (native/KPBridgeModule.swift).
 *
 * Every call degrades rather than throws. The module is optional, and a phone running a build made
 * before these functions existed has the module but not them, so each one is checked by name and
 * falls back: copying quietly does nothing, the language falls back to what Hermes knows through
 * `Intl`, and place search returns no results, leaving the map's tap-to-place-a-pin as it was.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

/** One result from Apple's map index. `address` may be empty for a point of interest with no street. */
export interface PlaceHit { name: string; address: string; lat: number; lon: number }

interface DeviceLocales { languages: string[]; locale: string; region: string; currency: string }

type DeviceNative = {
  copyToClipboard(text: string): void;
  readClipboard(): string;
  locales(): DeviceLocales;
  searchPlaces(query: string, lat: number | null, lon: number | null, limit: number): Promise<PlaceHit[]>;
};

const native = requireOptionalNativeModule<Partial<DeviceNative>>("KPBridge");

/** Put `text` on the pasteboard. True when it actually happened, so the caller can say "Copied". */
export function copyToClipboard(text: string): boolean {
  if (typeof native?.copyToClipboard !== "function") return false;
  try { native.copyToClipboard(text); return true; } catch { return false; }
}

/** Whatever text is on the pasteboard, or "" when there is none (or no native build to ask). */
export function readClipboard(): string {
  if (typeof native?.readClipboard !== "function") return "";
  try { return native.readClipboard(); } catch { return ""; }
}

/**
 * The languages the user has chosen in iOS, best first, plus the region their phone is set to.
 * Without the native module this still answers, through the one locale Hermes exposes — enough to
 * pick a language and a currency on the first launch.
 */
export function deviceLocales(): DeviceLocales {
  if (typeof native?.locales === "function") {
    try {
      const l = native.locales();
      if (l && Array.isArray(l.languages) && l.languages.length) return l;
    } catch { /* fall through */ }
  }
  let locale = "en-US";
  try { locale = Intl.DateTimeFormat().resolvedOptions().locale || locale; } catch { /* keep the default */ }
  return { languages: [locale], locale, region: "", currency: "" };
}

/**
 * Search Apple's map index, biased towards `near` when a fix is known. Free and keyless: it is the
 * same MKLocalSearch Apple Maps uses, and the query never leaves Apple's own stack.
 * Returns [] rather than throwing — a search that fails should leave the map usable.
 */
export async function searchPlaces(query: string, near?: { lat: number; lon: number } | null, limit = 12): Promise<PlaceHit[]> {
  const q = query.trim();
  if (!q || typeof native?.searchPlaces !== "function") return [];
  try {
    const hits = await native.searchPlaces(q, near?.lat ?? null, near?.lon ?? null, limit);
    return Array.isArray(hits) ? hits.filter((h) => Number.isFinite(h?.lat) && Number.isFinite(h?.lon)) : [];
  } catch { return []; }
}

/** False on a build made before place search existed, so the UI can leave the search field out. */
export const PLACE_SEARCH_AVAILABLE = typeof native?.searchPlaces === "function";
