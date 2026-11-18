import { useEffect, useRef, useState } from "react";
import Animated, { Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Tap } from "@/components/ui";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolvePick } from "@/store/pick";
import { takePhoto } from "@/lib/camera";
import { usePhotoReading } from "@/lib/photoText";
import { READ_SHEET_LOW, closePhotoViewer, openPhoto, showPhoto, useShownPhoto } from "@/lib/photoShown";
import { openOnce } from "@/lib/nav";
import { R, S } from "@/constants/theme";
import { t } from "@/i18n";

/** A line of light sweeping down the photo while its text is being read. */
function ScanLine({ height }: { height: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(y);
  }, [y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * height * 0.8 + height * 0.08 }] }));
  return (
    <Animated.View pointerEvents="none" entering={FadeIn} exiting={FadeOut.duration(400)} style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <Animated.View style={[styles.scanBand, style]}>
        <View style={styles.scanGlow} />
        <View style={styles.scanLine} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * What Continue hands back to the entry sheet, which fills itself in from the receipt and saves: the
 * entry's category, the parts to carve off, and the day the receipt is for.
 */
export interface PhotoSplit {
  category_id: string | null;
  /** The account it was paid from, when the receipt sheet asked (a receipt in another currency). */
  account_id?: string;
  /** YYYY-MM-DD, when it was changed on the sheet. */
  date?: string;
  /** What `amount_minor` below was worked out against. The entry's own total can differ — a
   *  receipt in another currency is converted only once it is filled in — and the entry sheet then
   *  scales each part to it. */
  basis?: number;
  /** Each with the lines of the items that made it, for its note, and the tags given to them. */
  parts: { category_id: string; amount_minor: number; note?: string; tag_ids?: string[] }[];
  /** The lines of the items that stayed with the entry, and the tags given to those. */
  note?: string;
  tag_ids?: string[];
}

/**
 * Full-screen look at a transaction's photo.
 *
 * Pinch to zoom, double-tap to zoom in on that spot and again to come back. Once it is on screen a
 * native sheet comes up over it with what the photo says (`photo/read`; lib/photoText.ts reads in
 * the background and keeps it, so a second look is instant). The photo is laid out above that
 * sheet's lowest height and stays put whatever the sheet does.
 *
 * "Remove" resolves `key` with `true` to the caller; "Replace" takes a new picture (lib/camera.ts),
 * shown here and read afresh in the sheet, and hands it to `replace`.
 */
export default function PhotoView() {
  const p = useLocalSearchParams<{ uri: string; key?: string; split?: string; total?: string; currency?: string; category?: string; date?: string; replace?: string; account?: string }>();
  useState(() => openPhoto(p.uri));
  const uri = useShownPhoto(p.uri);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reading = usePhotoReading(uri);
  const imgH = Math.round(height * (1 - READ_SHEET_LOW));

  // The sheet comes up once this screen has finished coming in: presented mid-transition, iOS drops it.
  const navigation = useNavigation();
  const opened = useRef(false);
  useEffect(() => {
    const open = () => {
      if (opened.current) return;
      opened.current = true;
      const { key: _key, replace: _replace, ...rest } = p;
      openOnce(`read:${p.uri}`, () => router.push({ pathname: "/photo/read", params: { ...rest, uri: p.uri } }));
    };
    const nav = navigation as unknown as { addListener: (type: "transitionEnd", cb: (e: { data: { closing: boolean } }) => void) => () => void };
    const off = nav.addListener("transitionEnd", (e) => { if (!e.data.closing) open(); });
    // Should the event not come, well after any presentation has settled.
    const timer = setTimeout(open, 700);
    return () => { off(); clearTimeout(timer); };
  }, [navigation, p]);

  const replacePhoto = () => void takePhoto().then((next) => {
    if (!next) return;
    showPhoto(next);
    if (p.replace) resolvePick(p.replace, next);
  });

  // ---- Zoom ---------------------------------------------------------------------------------------
  const zoomRef = useRef<ScrollView>(null);
  const scale = useRef(1);
  const lastTap = useRef(0);
  const onImagePress = (e: GestureResponderEvent) => {
    const now = Date.now();
    if (now - lastTap.current > 300) { lastTap.current = now; return; }
    lastTap.current = 0;
    const view = zoomRef.current as unknown as { scrollResponderZoomTo?: (r: { x: number; y: number; width: number; height: number; animated?: boolean }) => void } | null;
    if (scale.current > 1.05) { view?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height: imgH, animated: true }); return; }
    const { locationX: x, locationY: y } = e.nativeEvent;
    const w = width / 3, h = imgH / 3;
    view?.scrollResponderZoomTo?.({ x: x - w / 2, y: y - h / 2, width: w, height: h, animated: true });
  };

  return (
    <View style={styles.screen}>
      <ScrollView ref={zoomRef} style={{ position: "absolute", top: 0, left: 0, right: 0, height: imgH }} contentContainerStyle={{ width, height: imgH }}
        maximumZoomScale={6} minimumZoomScale={0.5} bouncesZoom centerContent
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
        onScroll={(e) => { scale.current = e.nativeEvent.zoomScale ?? 1; }} scrollEventThrottle={64}
        accessible accessibilityLabel={t("photo.read.zoomA11y")}>
        <Pressable onPress={onImagePress} style={{ width, height: imgH, paddingTop: insets.top + 52 }}>
          <Image source={{ uri }} style={{ flex: 1 }} contentFit="contain" transition={250} accessibilityLabel={t("photo.attached")} accessibilityIgnoresInvertColors />
        </Pressable>
      </ScrollView>
      {reading.status === "reading" ? <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 52, left: 0, right: 0, height: imgH - insets.top - 52 }}><ScanLine key={uri} height={imgH - insets.top - 52} /></View> : null}

      <Tap onPress={closePhotoViewer} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, right: S.lg }]} accessibilityRole="button" accessibilityLabel={t("common.close")}>
        <SymbolView name="xmark" size={18} tintColor="white" weight="semibold" />
      </Tap>
      {p.key ? (
        <Tap onPress={() => { resolvePick(p.key!, true); closePhotoViewer(); }} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, left: S.lg }]} accessibilityRole="button" accessibilityLabel={t("photo.remove")}>
          <SymbolView name="trash" size={17} tintColor="#ff6961" />
        </Tap>
      ) : null}
      {p.replace ? (
        <Tap onPress={replacePhoto} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, left: S.lg + (p.key ? 52 : 0) }]} accessibilityRole="button" accessibilityLabel={t("photo.replace")}>
          <SymbolView name="camera.rotate" size={17} tintColor="white" />
        </Tap>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "black" },
  btn: { position: "absolute", width: 40, height: 40, borderRadius: R.pill, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  scanBand: { position: "absolute", left: 0, right: 0, top: 0, height: 64, justifyContent: "flex-end" },
  scanGlow: { flex: 1, backgroundColor: "rgba(90,200,250,0.16)" },
  scanLine: { height: 2, backgroundColor: "#5ac8fa", shadowColor: "#5ac8fa", shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
});
