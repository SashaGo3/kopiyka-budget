import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import type { GoalStatus } from "@kopiyka/core";
import { C, S, themed } from "@/constants/theme";

/**
 * Siriusia, the seer of the Purrphecy card and of every savings goal — a real cat, photographed (the
 * same cut-outs as the Slowka app's cat, assets/siriusia). Six moods, each one picture:
 *
 * - `seer`: the straight stare. She is reading your future.
 * - `wow`: eyes wide. A number worth looking at twice.
 * - `happy`: eyes shut, content. On track.
 * - `proud`: paws in the air. Goal reached.
 * - `behind`: the look. Not on track.
 * - `sleep`: nothing is moving, so there is nothing to see.
 *
 * `float` lifts her gently up and down, as a seer over a crystal ball would; never with Reduce Motion.
 * A tap spins her round once — a cat does what it likes — and, with Reduce Motion, only taps back.
 *
 * One screen shows her once: two of the same picture side by side reads as a template, not a cat.
 * The Insights tab gives her to the first card that wants her (`cat` on `InsightCard`), and
 * Purrphecy's details have a single Siriusia whose words change with the tab.
 */
export type SiriusiaMood = "seer" | "wow" | "happy" | "proud" | "behind" | "sleep";

const PICTURES: Record<SiriusiaMood, number> = {
  seer: require("../../assets/siriusia/seer.png"),
  wow: require("../../assets/siriusia/wow.png"),
  happy: require("../../assets/siriusia/happy.png"),
  proud: require("../../assets/siriusia/proud.png"),
  behind: require("../../assets/siriusia/behind.png"),
  sleep: require("../../assets/siriusia/sleep.png"),
};

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
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: `${turn.value}deg` }] }));
  const spin = () => {
    void Haptics.selectionAsync();
    if (reduced) return;
    // Whole turns only, so a tap during a spin finishes on her feet rather than at an angle.
    turn.set(withTiming(Math.round(turn.get() / 360) * 360 + 360, { duration: 750, easing: Easing.inOut(Easing.cubic) }));
  };
  return (
    <Pressable onPress={spin} accessible={false} hitSlop={6}>
      <Animated.View style={[{ width: size, height: size }, lift, style]}>
        <Image source={PICTURES[mood]} style={{ width: size, height: size }} contentFit="contain" accessible={false} accessibilityIgnoresInvertColors />
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
