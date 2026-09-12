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
