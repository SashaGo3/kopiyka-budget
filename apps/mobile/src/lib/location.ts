/**
 * Fast, coarse location for logging: the last known fix if it is recent, otherwise a
 * low-accuracy request with a short timeout. Never blocks the entry sheet; the
 * result is attached when it arrives.
 */
import * as Location from "expo-location";
import { getLocationEnabled } from "./settings";

export interface Coords { lat: number; lon: number }

/** iOS permission state, independent of the app's own "Remember location" switch. */
export async function locationStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const cur = await Location.getForegroundPermissionsAsync();
  return cur.granted ? "granted" : cur.canAskAgain ? "undetermined" : "denied";
}

export async function ensureLocationPermission(): Promise<boolean> {
  const cur = await Location.getForegroundPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await Location.requestForegroundPermissionsAsync()).granted;
}

export async function quickLocation(timeoutMs = 4000): Promise<Coords | null> {
  if (!getLocationEnabled()) return null;
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 500 });
    if (last) return { lat: last.coords.latitude, lon: last.coords.longitude };
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    return fix ? { lat: fix.coords.latitude, lon: fix.coords.longitude } : null;
  } catch { return null; }
}

/**
 * A fix worth keeping, for the one deliberate read where the user is watching and waiting: setting
 * home. `quickLocation` is tuned the opposite way — it must never hold up the entry sheet, so it
 * takes a five-minute-old fix and gives up after four seconds. Neither of those is available in
 * the moment this is wanted: the permission has just been granted, so there is no cached fix to
 * settle for, and the first one iOS produces routinely takes longer than four seconds to arrive.
 * So this one waits, asks for a hundred metres rather than a kilometre, and only then falls back
 * to whatever was last known.
 */
export async function preciseLocation(timeoutMs = 15_000): Promise<Coords | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (fix) return { lat: fix.coords.latitude, lon: fix.coords.longitude };
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    return last ? { lat: last.coords.latitude, lon: last.coords.longitude } : null;
  } catch { return null; }
}

/** Best-effort place name (needs network); returns null quickly when unavailable. */
export async function placeName(c: Coords, timeoutMs = 3000): Promise<string | null> {
  try {
    const r = await Promise.race([Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lon }), new Promise<null>((res) => setTimeout(() => res(null), timeoutMs))]);
    const p = r?.[0];
    if (!p) return null;
    return p.name && p.name !== p.street ? p.name : [p.street, p.streetNumber].filter(Boolean).join(" ") || p.district || p.city || null;
  } catch { return null; }
}

/** City (or region / country) for a fix; the default name offered for a trip. */
export async function cityName(c: Coords, timeoutMs = 3000): Promise<string | null> {
  try {
    const r = await Promise.race([Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lon }), new Promise<null>((res) => setTimeout(() => res(null), timeoutMs))]);
    const p = r?.[0];
    return p?.city || p?.subregion || p?.region || p?.country || null;
  } catch { return null; }
}

/**
 * ISO 3166-1 country code for a fix ("PL"), or null. Used to offer the right currency to someone
 * whose phone is still set to the region they moved away from.
 */
export async function countryCode(c: Coords, timeoutMs = 3000): Promise<string | null> {
  try {
    const r = await Promise.race([Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lon }), new Promise<null>((res) => setTimeout(() => res(null), timeoutMs))]);
    return r?.[0]?.isoCountryCode?.toUpperCase() || null;
  } catch { return null; }
}
