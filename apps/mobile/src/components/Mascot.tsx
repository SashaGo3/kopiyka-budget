import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { S } from "@/constants/theme";
import { onCheer, type Moment } from "@/lib/mascot";
import moments from "../../assets/mascot/moments.json";

/**
 * The cat. Every clip is a transparent animated WebP made by scripts/mascot/make-mascot.mjs, and
 * every clip starts and ends on the same still, so a one-shot clip is swapped for the still when it
 * finishes and nothing jumps. With Reduce Motion on, only the still is ever shown.
 */
const CLIPS: Record<Moment, number> = {
  hello: require("../../assets/mascot/hello.webp"),
  ready: require("../../assets/mascot/ready.webp"),
  coin: require("../../assets/mascot/coin.webp"),
  salary: require("../../assets/mascot/salary.webp"),
  proud: require("../../assets/mascot/proud.webp"),
  worried: require("../../assets/mascot/worried.webp"),
  sleep: require("../../assets/mascot/sleep.webp"),
  debt: require("../../assets/mascot/debt.webp"),
  oops: require("../../assets/mascot/oops.webp"),
};
const STILL = require("../../assets/mascot/still.png");

export function Mascot({ moment, size = 120 }: { moment: Moment; size?: number }) {
  const reduced = useReducedMotion();
  const { loop, ms } = moments[moment];
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    if (loop || reduced) return;
    const id = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(id);
  }, [moment, loop, ms, reduced]);
  return (
    <Image source={reduced || done ? STILL : CLIPS[moment]} style={{ width: size, height: size }} contentFit="contain"
      accessible={false} accessibilityIgnoresInvertColors />
  );
}

/**
 * The cat that pops up over whatever screen is showing after something worth a moment — mounted
 * once in the root layout, fed by `cheer()` (lib/mascot.ts). It never takes a touch.
 */
export function MascotToast() {
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<{ moment: Moment; key: number } | null>(null);
  useEffect(() => onCheer((moment) => setShown({ moment, key: Date.now() })), []);
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), moments[shown.moment].ms + 400);
    return () => clearTimeout(id);
  }, [shown]);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={[styles.layer, { paddingBottom: insets.bottom + 72 }]}>
      <Animated.View key={shown.key} entering={FadeInDown.springify()} exiting={FadeOutDown}>
        <Mascot moment={shown.moment} size={140} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, justifyContent: "flex-end", alignItems: "center", paddingHorizontal: S.xl },
});
