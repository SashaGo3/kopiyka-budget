import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { SpendPlace } from "@kopiyka/core";
import { R, S, themed } from "@/constants/theme";

/**
 * Where the money went, as circles on a map: one per place (core `spendingPlaces`), its area in
 * proportion to what was spent there and its fill stronger the more it was, so the eye goes to the
 * big ones first. Opened on everything at once — the camera takes the middle of the places and a zoom
 * that holds them all.
 */
export function SpendMap({ places, height = 320 }: { places: SpendPlace[]; height?: number }) {
  // expo-maps is a heavy import (MapKit bridging); deferred until a map is actually drawn, as on pick/location.tsx.
  const { AppleMaps } = require("expo-maps") as typeof import("expo-maps"); // eslint-disable-line @typescript-eslint/no-require-imports
  const view = useMemo(() => {
    if (!places.length) return null;
    const lats = places.map((p) => p.lat), lons = places.map((p) => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const midLat = (minLat + maxLat) / 2, midLon = (minLon + maxLon) / 2;
    // The span in metres, and a zoom that fits it with a margin: each zoom level halves the width.
    const spanM = Math.max((maxLat - minLat) * 111_000, (maxLon - minLon) * 111_000 * Math.cos((midLat * Math.PI) / 180), 600);
    const zoom = Math.max(3, Math.min(16, Math.log2((40_000_000 / (spanM * 2.2)) * (height / 512))));
    const max = Math.max(...places.map((p) => p.spent_minor), 1);
    // The biggest circle is a slice of the view; a small one is still big enough to find.
    const maxR = Math.min(Math.max(spanM / 10, 60), 5000);
    const circles = places.map((p) => {
      const share = p.spent_minor / max;
      return {
        id: p.key,
        center: { latitude: p.lat, longitude: p.lon },
        radius: Math.max(maxR * Math.sqrt(share), maxR * 0.15),
        color: `rgba(255, 55, 95, ${(0.18 + 0.42 * share).toFixed(2)})`,
        lineColor: "rgba(255, 55, 95, 0.9)",
        lineWidth: 1,
      };
    });
    return { camera: { coordinates: { latitude: midLat, longitude: midLon }, zoom }, circles };
  }, [places, height]);
  if (!view) return null;
  return (
    <View style={[styles.frame, { height }]}>
      <AppleMaps.View style={{ flex: 1 }} cameraPosition={view.camera} circles={view.circles}
        uiSettings={{ myLocationButtonEnabled: false, compassEnabled: false }} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  frame: { marginHorizontal: S.lg, borderRadius: R.md, overflow: "hidden" },
}));
