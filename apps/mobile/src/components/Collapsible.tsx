import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

/** How long a fold takes. Short enough to feel like a response, long enough to show where it went. */
const DURATION = 260;

/**
 * Content that unfolds in place and folds away again — the ⓘ notes, a group of categories, a
 * trip's spending by category.
 *
 * It replaces `LayoutAnimation`, which animated the whole screen's next layout and could not be
 * stopped: a second tap halfway through jumped to the end and started over. Here the height is a
 * shared value on the UI thread, so a tap at any moment turns it round from exactly where it is,
 * and everything below follows frame by frame because the block really is that tall.
 *
 * The content is measured where it cannot be seen (absolutely placed, so its natural height is
 * known whatever the fold is doing) and kept current if it changes. Folded, it is hidden from
 * VoiceOver and takes no touches. With Reduce Motion it simply opens and closes. `lazy` keeps the
 * content unmounted until it is first opened, for a list of many folds that are mostly shut.
 */
export function Collapsible({ open, children, lazy, style }: { open: boolean; children: ReactNode; lazy?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(open);
  const height = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    if (open) setSeen(true); // eslint-disable-line react-hooks/set-state-in-effect
    const to = open ? 1 : 0;
    progress.value = reduced ? to : withTiming(to, { duration: DURATION, easing: Easing.out(Easing.cubic) });
  }, [open, reduced, progress]);
  const animated = useAnimatedStyle(() => ({ height: height.value * progress.value, opacity: 0.25 + 0.75 * progress.value }));
  if (lazy && !seen) return null;
  return (
    <Animated.View style={[styles.clip, animated, style]} pointerEvents={open ? "auto" : "none"}>
      <View style={styles.measure} onLayout={(e) => { height.value = e.nativeEvent.layout.height; }}
        accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  measure: { position: "absolute", left: 0, right: 0, top: 0 },
});
