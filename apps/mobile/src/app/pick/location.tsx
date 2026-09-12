import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { resolvePick } from "@/store/pick";
import { ModalHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { ensureLocationPermission, placeName, quickLocation, type Coords } from "@/lib/location";
import { getHomeLocation } from "@/lib/settings";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Native Apple Maps: tap anywhere to move the pin. Resolves { lat, lon, place } or null to remove the location. */
export default function PickLocation() {
  // expo-maps is a heavy import (MapKit bridging) other routes never need; deferred until this screen actually mounts.
  const { AppleMaps } = require("expo-maps") as typeof import("expo-maps"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { key, lat, lon } = useLocalSearchParams<{ key: string; lat?: string; lon?: string }>();
  const initial = lat && lon ? { lat: Number(lat), lon: Number(lon) } : null;
  const [coords, setCoords] = useState<Coords | null>(initial);
  const [place, setPlace] = useState<string | null>(null);
  // Before a fix arrives the map opens on the entry's own pin, else on the user's home, else zoomed
  // out on the whole world — never on a place the app has no reason to know about.
  const home = getHomeLocation();
  const [camera, setCameraState] = useState<Coords>(initial ?? (home ? { lat: home.lat, lon: home.lon } : { lat: 20, lon: 0 }));
  const [zoom, setZoom] = useState(initial || home ? 15 : 1);
  const setCamera = (c: Coords) => { setCameraState(c); setZoom(15); };
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (initial) return;
    void (async () => { if (await ensureLocationPermission()) { const c = await quickLocation(); if (c) { setCoords(c); setCamera(c); } } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    if (!coords) { setPlace(null); return; }
    void placeName(coords).then((n) => { if (alive) setPlace(n); });
    return () => { alive = false; };
  }, [coords?.lat, coords?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => { resolvePick(key, coords ? { ...coords, place } : null); router.back(); };
  const here = async () => { if (!(await ensureLocationPermission())) return; const c = await quickLocation(6000); if (c) { setCoords(c); setCamera(c); } };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title="Location" left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Done", onPress: done }} />
      <AppleMaps.View
        style={{ flex: 1 }}
        cameraPosition={{ coordinates: { latitude: camera.lat, longitude: camera.lon }, zoom }}
        markers={coords ? [{ coordinates: { latitude: coords.lat, longitude: coords.lon }, title: place ?? "Here", tintColor: "#FF375F" }] : []}
        uiSettings={{ myLocationButtonEnabled: false, compassEnabled: false }}
        properties={{ isMyLocationEnabled: true }}
        onMapClick={(e) => { if (e.coordinates.latitude != null && e.coordinates.longitude != null) setCoords({ lat: e.coordinates.latitude, lon: e.coordinates.longitude }); }}
      />
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <Text style={styles.place} numberOfLines={1}>{coords ? `📍 ${place ?? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`}` : "Tap the map to place the pin"}</Text>
        <View style={styles.row}>
          <Pressable onPress={() => void here()} style={styles.btn} accessibilityRole="button" accessibilityLabel="Use current location"><SymbolView name="location.fill" size={16} tintColor={C.tint} /><Text style={styles.btnText}>Current</Text></Pressable>
          {coords ? <Pressable onPress={() => setCoords(null)} style={styles.btn} accessibilityRole="button" accessibilityLabel="Remove location"><SymbolView name="xmark" size={14} tintColor={C.red} /><Text style={[styles.btnText, { color: C.red }]}>Remove</Text></Pressable> : null}
          <Pressable onPress={done} style={[styles.btn, styles.primary]} accessibilityRole="button" accessibilityLabel="Use this location"><Text style={[styles.btnText, { color: C.onTint }]}>Use this location</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: { paddingHorizontal: S.md, paddingTop: S.md, gap: S.sm, backgroundColor: C.bgGrouped },
  place: { color: C.secondary, fontSize: 14, paddingHorizontal: S.xs },
  row: { flexDirection: "row", gap: S.sm },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.card },
  primary: { flex: 1, backgroundColor: C.tint },
  btnText: { color: C.tint, fontSize: 16, fontWeight: "600" },
});
