import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { resolvePick } from "@/store/pick";
import { ModalHeader } from "@/components/ui";
import { useT } from "@/i18n";
import { C, S } from "@/constants/theme";
import { ensureLocationPermission, placeName, quickLocation, type Coords } from "@/lib/location";
import { PLACE_SEARCH_AVAILABLE, searchPlaces, type PlaceHit } from "@/lib/device";
import { getHomeLocation } from "@/lib/settings";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Long enough that typing a shop name is one search and not eight. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Native Apple Maps: search for a place by name, or tap anywhere to move the pin.
 * Resolves { lat, lon, place } or null to remove the location.
 *
 * The search is MapKit's own `MKLocalSearch` (native/KPDevice.swift) — the index Apple Maps uses.
 * It costs nothing, needs no key and no account, and the query goes to Apple rather than to a
 * geocoding service that would learn where this phone looks things up. Results are biased towards
 * the pin, so "pharmacy" finds the one down the road. On a build made before the search existed the
 * field is simply not drawn and the map behaves as it always did.
 */
export default function PickLocation() {
  // expo-maps is a heavy import (MapKit bridging) other routes never need; deferred until this screen actually mounts.
  const { AppleMaps } = require("expo-maps") as typeof import("expo-maps"); // eslint-disable-line @typescript-eslint/no-require-imports
  const t = useT();
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

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  // The pin the user last chose from the search: shown as the place name instead of the reverse
  // geocode, because the name they picked is the one they meant.
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    void (async () => { if (await ensureLocationPermission()) { const c = await quickLocation(); if (c) { setCoords(c); setCamera(c); } } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    if (!coords) { setPlace(null); return; }
    if (chosen) { setPlace(chosen); return; }
    void placeName(coords).then((n) => { if (alive) setPlace(n); });
    return () => { alive = false; };
  }, [coords?.lat, coords?.lon, chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search. `seq` drops the answer to a query the user has already typed past; clearing
  // happens where the typing does, so the effect only ever schedules and never resets state itself.
  const seq = useRef(0);
  const long = PLACE_SEARCH_AVAILABLE && query.trim().length >= 2;
  const type = (next: string) => {
    setQuery(next);
    if (next.trim().length < 2) { seq.current++; setHits([]); setSearching(false); return; }
    setSearching(true);
  };
  useEffect(() => {
    if (!long) return;
    const q = query.trim();
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void searchPlaces(q, coords ?? camera).then((found) => {
        if (seq.current !== mine) return;
        setHits(found);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, long, coords?.lat, coords?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => { resolvePick(key, coords ? { ...coords, place } : null); router.back(); };
  const here = async () => {
    if (!(await ensureLocationPermission())) return;
    const c = await quickLocation(6000);
    if (!c) return;
    setChosen(null); setCoords(c); setCamera(c);
  };
  const choose = (h: PlaceHit) => {
    Keyboard.dismiss();
    setChosen(h.name || h.address || null);
    setCoords({ lat: h.lat, lon: h.lon });
    setCamera({ lat: h.lat, lon: h.lon });
    seq.current++; setQuery(""); setHits([]); setSearching(false);
  };
  const tapMap = (c: Coords) => { setChosen(null); setCoords(c); };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("Location")} left={{ label: t("Cancel"), onPress: () => router.back() }} right={{ label: t("Done"), onPress: done }} />
      {PLACE_SEARCH_AVAILABLE ? (
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
          <TextInput value={query} onChangeText={type} placeholder={t("Search for a place")} placeholderTextColor={C.tertiary} style={styles.input}
            autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel={t("Search for a place")} />
          {searching ? <ActivityIndicator size="small" color={C.tertiary} /> : null}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <AppleMaps.View
          style={{ flex: 1 }}
          cameraPosition={{ coordinates: { latitude: camera.lat, longitude: camera.lon }, zoom }}
          markers={coords ? [{ coordinates: { latitude: coords.lat, longitude: coords.lon }, title: place ?? t("Here"), tintColor: "#FF375F" }] : []}
          uiSettings={{ myLocationButtonEnabled: false, compassEnabled: false }}
          properties={{ isMyLocationEnabled: true }}
          onMapClick={(e) => { if (e.coordinates.latitude != null && e.coordinates.longitude != null) tapMap({ lat: e.coordinates.latitude, lon: e.coordinates.longitude }); }}
        />
        {/* Results sit over the map rather than pushing it: the pin stays visible while choosing. */}
        {hits.length ? (
          <View style={styles.results}>
            <FlatList data={hits} keyExtractor={(h, i) => `${h.lat},${h.lon},${i}`} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
              renderItem={({ item }) => (
                <Pressable onPress={() => choose(item)} style={({ pressed }) => [styles.hit, pressed && { backgroundColor: C.fill }]}
                  accessibilityRole="button" accessibilityLabel={item.address ? `${item.name}, ${item.address}` : item.name}>
                  <SymbolView name="mappin.circle.fill" size={20} tintColor={C.tint} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.hitName} numberOfLines={1}>{item.name || item.address}</Text>
                    {item.address && item.name ? <Text style={styles.hitSub} numberOfLines={1}>{item.address}</Text> : null}
                  </View>
                </Pressable>
              )} />
          </View>
        ) : null}
        {long && !searching && !hits.length ? (
          <View style={styles.results}><Text style={styles.none}>{t("No places found.")}</Text></View>
        ) : null}
      </View>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <Text style={styles.place} numberOfLines={1}>{coords ? `📍 ${place ?? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`}` : t("Tap the map to place the pin")}</Text>
        <View style={styles.row}>
          <Pressable onPress={() => void here()} style={styles.btn} accessibilityRole="button" accessibilityLabel={t("Use current location")}><SymbolView name="location.fill" size={16} tintColor={C.tint} /><Text style={styles.btnText}>{t("Current")}</Text></Pressable>
          {coords ? <Pressable onPress={() => { setChosen(null); setCoords(null); }} style={styles.btn} accessibilityRole="button" accessibilityLabel={t("Remove location")}><SymbolView name="xmark" size={14} tintColor={C.red} /><Text style={[styles.btnText, { color: C.red }]}>{t("Remove")}</Text></Pressable> : null}
          <Pressable onPress={done} style={[styles.btn, styles.primary]} accessibilityRole="button" accessibilityLabel={t("Use this location")}><Text style={[styles.btnText, { color: C.onTint }]}>{t("Use this location")}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.md, marginBottom: S.sm, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  results: { position: "absolute", left: S.md, right: S.md, top: 0, maxHeight: 260, borderRadius: 14, backgroundColor: C.card, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  hit: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, paddingVertical: 10, minHeight: 48 },
  hitName: { fontSize: 16, color: C.label },
  hitSub: { fontSize: 13, color: C.secondary },
  none: { color: C.tertiary, fontSize: 14, padding: S.md, textAlign: "center" },
  bottom: { paddingHorizontal: S.md, paddingTop: S.md, gap: S.sm, backgroundColor: C.bgGrouped },
  place: { color: C.secondary, fontSize: 14, paddingHorizontal: S.xs },
  row: { flexDirection: "row", gap: S.sm },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.card },
  primary: { flex: 1, backgroundColor: C.tint },
  btnText: { color: C.tint, fontSize: 16, fontWeight: "600" },
});
