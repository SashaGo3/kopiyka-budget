import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { GoalStatus } from "@kopiyka/core";
import { C, S, themed } from "@/constants/theme";

/**
 * Siriusia, the seer of the Purrphecy card and of every savings goal — a real cat, photographed (the
 * same cut-outs as the Slowka app's cat, assets/siriusia). Six moods, a few pictures each:
 *
 * - `seer`: the straight stare. She is reading your future.
 * - `wow`: eyes wide. A number worth looking at twice.
 * - `happy`: content. On track.
 * - `proud`: paws in the air. Goal reached.
 * - `behind`: the look. Not on track.
 * - `sleep`: nothing is moving, so there is nothing to see.
 *
 * Which of a mood's pictures shows is picked when she appears, so the same card is not the same cat
 * every time.
 *
 * `float` lifts her gently up and down, as a seer over a crystal ball would; never with Reduce Motion.
 * A tap sets her spinning, and every tap that follows spins her faster. Stop, and she slows down
 * onto her feet — a whole turn, never left at an angle — shrinking as she goes, then springs back
 * as another picture of the same mood. A tap at any point of that takes over from wherever she is.
 * With Reduce Motion a tap only swaps the picture.
 *
 * One screen shows her once: two of the same picture side by side reads as a template, not a cat.
 * The Insights tab gives her to the first card that wants her (`cat` on `InsightCard`), and
 * Purrphecy's details have a single Siriusia whose words change with the tab.
 */
export type SiriusiaMood = "seer" | "wow" | "happy" | "proud" | "behind" | "sleep";

const PICTURES: Record<SiriusiaMood, number[]> = {
  seer: [require("../../assets/siriusia/seer.png"), require("../../assets/siriusia/seer-2.png"), require("../../assets/siriusia/seer-3.png")],
  wow: [require("../../assets/siriusia/wow.png"), require("../../assets/siriusia/wow-2.png")],
  happy: [require("../../assets/siriusia/happy.png"), require("../../assets/siriusia/happy-2.png"), require("../../assets/siriusia/happy-3.png")],
  proud: [require("../../assets/siriusia/proud.png"), require("../../assets/siriusia/proud-2.png"), require("../../assets/siriusia/proud-3.png")],
  behind: [require("../../assets/siriusia/behind.png"), require("../../assets/siriusia/behind-2.png"), require("../../assets/siriusia/behind-3.png")],
  sleep: [require("../../assets/siriusia/sleep.png"), require("../../assets/siriusia/sleep-2.png"), require("../../assets/siriusia/sleep-3.png")],
};

/** The first tap's speed, what each one after it adds, and the most she will do — degrees a second. */
const SPIN_START = 360;
const SPIN_STEP = 300;
const SPIN_MAX = 2880;
/** How long without a tap counts as having stopped. */
const SPIN_IDLE_MS = 450;
/** How small she gets while she slows down. */
const SPIN_SHRINK = 0.62;

/** The mood a goal puts her in. */
export function goalMood(status: GoalStatus): SiriusiaMood {
  switch (status) {
    case "done": return "proud";
    case "on_track": return "happy";
    case "behind": return "behind";
    case "stalled": return "sleep";
    default: return "seer";
  }
}

export function Siriusia({ mood, size = 72, float, style }: { mood: SiriusiaMood; size?: number; float?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const pictures = PICTURES[mood];
  const [pick, setPick] = useState(() => Math.floor(Math.random() * 1000));
  const next = () => setPick((p) => p + 1);
  const landed = () => { next(); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft); };

  const y = useSharedValue(0);
  useEffect(() => {
    if (!float || reduced) { cancelAnimation(y); y.value = 0; return; }
    y.value = withRepeat(withSequence(
      withTiming(-4, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
    ), -1);
    return () => cancelAnimation(y);
  }, [float, reduced, y]);

  const turn = useSharedValue(0);
  const speed = useSharedValue(0); // degrees a second while the taps keep coming
  const scale = useSharedValue(1);
  const spinning = useFrameCallback((f) => {
    turn.set(turn.get() + speed.get() * ((f.timeSincePreviousFrame ?? 16) / 1000));
  }, false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);

  const settle = () => {
    idle.current = null;
    spinning.setActive(false);
    const v = speed.get() / 1000; // degrees a millisecond
    const from = turn.get();
    // Easing out of a quadratic starts at twice its average speed, so the distance that keeps her
    // speed at the hand-over is v·T/2 — rounded up to the next whole turn, which sets T.
    const to = Math.ceil((from + Math.max(v, 0.36) * 500) / 360) * 360;
    const duration = Math.min(2400, Math.max(500, (2 * (to - from)) / Math.max(v, 0.1)));
    scale.set(withTiming(SPIN_SHRINK, { duration, easing: Easing.out(Easing.quad) }));
    turn.set(withTiming(to, { duration, easing: Easing.out(Easing.quad) }, (done) => {
      if (!done) return;
      turn.set(0); // a whole number of turns is the same as none
      speed.set(0);
      scale.set(withSpring(1, { damping: 11, stiffness: 180 }));
      scheduleOnRN(landed);
    }));
  };

  const tap = () => {
    void Haptics.selectionAsync();
    if (reduced) { next(); return; }
    // Take over from wherever she is: mid-slowdown, mid-shrink or still. A tap while she is still
    // turning — spinning or slowing down — is one more of the same run, so it only adds speed.
    cancelAnimation(turn);
    cancelAnimation(scale);
    scale.set(withSpring(1, { damping: 14, stiffness: 220 }));
    speed.set(speed.get() > 0 ? Math.min(SPIN_MAX, speed.get() + SPIN_STEP) : SPIN_START);
    spinning.setActive(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(settle, SPIN_IDLE_MS);
  };

  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: `${turn.value}deg` }, { scale: scale.value }] }));
  return (
    <Pressable onPress={tap} accessible={false} hitSlop={6}>
      <Animated.View style={[{ width: size, height: size }, lift, style]}>
        <Image source={pictures[pick % pictures.length]} style={{ width: size, height: size }} contentFit="contain" transition={reduced ? 200 : 0} accessible={false} accessibilityIgnoresInvertColors />
      </Animated.View>
    </Pressable>
  );
}

/** Siriusia with something to say: the picture and a speech bubble beside it. */
export function SiriusiaSays({ mood, children, size = 88, float }: { mood: SiriusiaMood; children: string; size?: number; float?: boolean }) {
  return (
    <View style={styles.says} accessible accessibilityLabel={children}>
      <Siriusia mood={mood} size={size} float={float} />
      <View style={styles.bubble}>
        <View style={styles.tail} />
        <Text style={styles.bubbleText}>{children}</Text>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  says: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg },
  bubble: { flex: 1, backgroundColor: C.card, borderRadius: 16, paddingHorizontal: S.md, paddingVertical: 10 },
  tail: { position: "absolute", left: -6, top: "50%", marginTop: -6, width: 12, height: 12, backgroundColor: C.card, transform: [{ rotate: "45deg" }], borderRadius: 2 },
  bubbleText: { fontSize: 15, lineHeight: 20, color: C.label, fontStyle: "italic" },
}));
