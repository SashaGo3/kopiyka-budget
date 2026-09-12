import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View, useColorScheme, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import Animated, { Easing, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type AnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, S } from "@/constants/theme";
import { isBooted, markBooted, onBooted } from "@/lib/boot";

/** Soft highlight band: an inline SVG gradient so no extra native module is needed. */
const band = (opacity: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="8" viewBox="0 0 240 8" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="${opacity}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="240" height="8" fill="url(#g)"/></svg>`,
  )}`;

const Shimmer = createContext<{ uri: string; sweep: AnimatedStyle<ViewStyle>; width: number } | null>(null);

/** A grey placeholder block that the shared highlight sweeps across. */
function Bone({ w, h, r = 6, style }: { w: number | `${number}%`; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const ctx = useContext(Shimmer);
  return (
    <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.fill, overflow: "hidden" }, style]}>
      {ctx ? (
        <Animated.View style={[StyleSheet.absoluteFill, { width: ctx.width }, ctx.sweep]}>
          <Image source={{ uri: ctx.uri }} style={StyleSheet.absoluteFill} contentFit="fill" />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** One day's card of transaction rows — the shape the landing list paints first. */
function DayCard({ rows }: { rows: number }) {
  return (
    <View style={styles.card}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.row, i > 0 && { marginTop: S.md }]}>
          <Bone w={34} h={34} r={17} />
          <View style={{ flex: 1, gap: 6 }}>
            <Bone w={`${45 + ((i * 13) % 30)}%`} h={14} />
            <Bone w={`${25 + ((i * 7) % 18)}%`} h={11} />
          </View>
          <Bone w={72} h={16} r={8} />
        </View>
      ))}
    </View>
  );
}

/**
 * Full-screen stand-in for the Transactions home, shown from the very first JS frame (the native
 * launch screen is just the same background colour) until the landing screen has painted.
 * Fades out on `markBooted()`, or after a safety timeout if a deep link lands elsewhere.
 */
export function BootSkeleton() {
  const [visible, setVisible] = useState(() => !isBooted());
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [progress]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => setVisible(false);
    const timeout = setTimeout(hide, 2500);
    // Deferred startup work (backup triggers, widget snapshot, auto-posting) waits on `onBooted`;
    // guarantee it still fires even when the landing screen never mounts (a deep link straight to
    // a sheet skips the landing tab entirely, so it would never call `markBooted()` itself).
    const safety = setTimeout(markBooted, 1500);
    const off = onBooted(() => requestAnimationFrame(hide));
    return () => { clearTimeout(timeout); clearTimeout(safety); off(); };
  }, [visible]);

  // A deep link that opens straight on a sheet (widget / watch / Shortcut) must never be covered
  // by this skeleton, which is drawn for the Transactions landing screen only.
  useEffect(() => {
    let alive = true;
    void Linking.getInitialURL().then((url) => {
      if (!alive || !url) return;
      const path = (url.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").split(/[?#]/)[0] ?? "").replace(/^\/+|\/+$/g, "");
      if (path) setVisible(false);
    });
    return () => { alive = false; };
  }, []);

  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -width + progress.value * 2 * width }, { skewX: "-18deg" }] }));
  const ctx = useMemo(() => ({ uri: band(dark ? 0.12 : 0.85), sweep, width }), [dark, sweep, width]);

  if (!visible) return null;
  return (
    <Animated.View exiting={FadeOut.duration(260)} pointerEvents="none" style={[StyleSheet.absoluteFill, styles.screen, { paddingTop: insets.top + S.sm }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Shimmer.Provider value={ctx}>
        {/* One period pill, no scope pill: Transactions is the landing tab. */}
        <View style={[styles.row, { paddingHorizontal: S.lg }]}>
          <Bone w={124} h={32} r={16} />
        </View>
        <Bone w={180} h={34} r={8} style={{ marginHorizontal: S.lg, marginTop: S.lg }} />
        <View style={styles.cards}>
          <Summary />
          <Summary />
        </View>
        <Bone w={120} h={13} style={{ marginHorizontal: S.lg, marginTop: S.xl, marginBottom: S.sm }} />
        <DayCard rows={3} />
        <Bone w={140} h={13} style={{ marginHorizontal: S.lg, marginTop: S.lg, marginBottom: S.sm }} />
        <DayCard rows={4} />
      </Shimmer.Provider>
    </Animated.View>
  );
}

function Summary() {
  return (
    <View style={[styles.card, { flex: 1, marginHorizontal: 0, gap: 8 }]}>
      <Bone w={64} h={13} />
      <Bone w={104} h={20} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bgGrouped, zIndex: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: S.sm },
  cards: { flexDirection: "row", gap: S.md, paddingHorizontal: S.lg, paddingTop: S.md },
  card: { marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: C.card, borderRadius: R.card, padding: S.md, gap: 6 },
});
