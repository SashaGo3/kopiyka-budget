import { useEffect, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import { C } from "@/constants/theme";
import { coverPainted, onReveal } from "@/lib/boot";

/** The mark's width in points: app.json's splash `imageWidth`, so the two К line up exactly. */
const MARK_WIDTH = 96;
/** The art's own proportions (assets/splash, 288 × 389 px). */
const MARK_ASPECT = 288 / 389;
/** The body under the face, as scripts/make-icons.mjs draws it on the native launch screen. */
const SIDE_OPACITY = 0.35;

const body = require("../../assets/splash/kay-body.png");
const face = require("../../assets/splash/kay-face.png");

/**
 * The launch screen again, in the chosen theme: its page colour, and the К in its text colour with
 * the extrusion at `SIDE_OPACITY` of it — white silhouettes tinted here, so every theme, light and
 * dark, is drawn from the same two files. iOS can only show the native launch screen in the default
 * theme; this takes over from it as soon as it has painted (`coverPainted`), and once the first
 * screen is up (`onReveal`) the mark swells slightly as the whole cover fades off it. It never takes
 * a touch, and is gone from the tree afterwards.
 */
export function LaunchCover() {
  const [fade] = useState(() => new Animated.Value(1));
  const [gone, setGone] = useState(false);
  useEffect(() => onReveal(() => {
    Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => setGone(true));
  }), [fade]);
  if (gone) return null;
  const scale = fade.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] });
  return (
    <Animated.View pointerEvents="none" onLayout={coverPainted} style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: C.bg, opacity: fade }]}>
      <Animated.View style={[styles.mark, { transform: [{ scale }] }]}>
        <Animated.Image source={body} style={[StyleSheet.absoluteFill, styles.art, { tintColor: C.label, opacity: SIDE_OPACITY }]} />
        <Animated.Image source={face} style={[StyleSheet.absoluteFill, styles.art, { tintColor: C.label }]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: "center", justifyContent: "center" },
  mark: { width: MARK_WIDTH, aspectRatio: MARK_ASPECT },
  art: { width: "100%", height: "100%", resizeMode: "contain" },
});
