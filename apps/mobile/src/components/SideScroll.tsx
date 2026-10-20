import { useState, type ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withDecay, withSpring } from "react-native-reanimated";

/**
 * A row that scrolls sideways under a finger, for use inside a form sheet — where a real ScrollView
 * cannot go. react-native-screens takes any ScrollView it finds in a sheet for the sheet's own and
 * moves it to the sheet's top at the sheet's full size (RNSScreen `correctScrollViewFrame`), so the
 * budget sheet's averages kept landing over its title. This is a pan and a translation instead:
 * nothing for the sheet to find. Taps on what is inside still land, because the pan only starts
 * after the finger has moved sideways.
 */
export function SideScroll({ children, style, contentStyle, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const min = Math.min(0, box - content);
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onStart(() => { start.value = x.value; })
    .onUpdate((e) => {
      const next = start.value + e.translationX;
      // Past either end it gives a little, the way a scroll view's edge does.
      x.value = next > 0 ? next / 3 : next < min ? min + (next - min) / 3 : next;
    })
    .onEnd((e) => {
      if (x.value > 0 || x.value < min) x.value = withSpring(x.value > 0 ? 0 : min, { damping: 20, stiffness: 200 });
      else x.value = withDecay({ velocity: e.velocityX, clamp: [min, 0] });
    });
  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <GestureHandlerRootView style={[styles.clip, style]} onLayout={(e) => setBox(e.nativeEvent.layout.width)} accessibilityLabel={accessibilityLabel}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.row, contentStyle, moved]} onLayout={(e) => setContent(e.nativeEvent.layout.width)}>{children}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", flexGrow: 0 },
  // Laid out at its own width, not the box's, so it can be wider than the screen.
  row: { flexDirection: "row", alignSelf: "flex-start" },
});
