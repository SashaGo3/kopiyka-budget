import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { onUndoOffer, settleUndo, takeUndo, type UndoOffer } from "@/lib/undo";
import { Tap } from "@/components/ui";
import { Glass } from "@/components/glass";
import { C, Elevation, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/** How long the way back stays open. Long enough to read, short enough not to linger. */
const UNDO_MS = 5000;

/**
 * The toast an `offerUndo` shows, once, at the root of the app: above the tab bar, over whatever
 * screen the action left you on. Reanimated's entering and exiting animations follow the system's
 * Reduce Motion setting on their own, so it simply appears and goes there.
 *
 * It floats, so it is drawn like the rest of the floating layer — the bottom bar's glass, the app's
 * own label and tint colours — rather than an inverted slab that belonged to no theme. A swipe down
 * sends it away: the action stands, exactly as if it had timed out.
 */
export function UndoToast() {
  const insets = useSafeAreaInsets();
  const [offer, setOffer] = useState<(UndoOffer & { id: number }) | null>(null);
  useEffect(() => onUndoOffer(setOffer), []);
  useEffect(() => {
    if (!offer) return;
    const id = setTimeout(() => settleUndo(offer.id), UNDO_MS);
    return () => clearTimeout(id);
  }, [offer]);
  if (!offer) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.wrap, { paddingBottom: insets.bottom + 72 }]}>
      <Toast key={offer.id} offer={offer} />
    </View>
  );
}

/** One offer's toast. Keyed by the offer, so a new one starts where a toast starts, not where the last was dragged. */
function Toast({ offer }: { offer: UndoOffer & { id: number } }) {
  const y = useSharedValue(0);
  const id = offer.id;
  // Only downwards, and only once the finger has clearly moved, so a tap on Undo is still a tap.
  // Upwards it gives a little and comes back, the way a sheet's edge does.
  const pan = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onUpdate((e) => { y.value = e.translationY > 0 ? e.translationY : e.translationY / 4; })
    .onEnd((e) => {
      if (e.translationY > 28 || e.velocityY > 600) {
        y.value = withTiming(160, { duration: 160 });
        scheduleOnRN(settleUndo, id);
      } else y.value = withSpring(0, { damping: 20, stiffness: 260 });
    });
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: 1 - Math.min(Math.max(y.value, 0) / 160, 1) }));
  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={pan}>
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(160)} style={[styles.shadow, moved]}
          accessibilityLiveRegion="polite" accessible={false}
          accessibilityActions={[{ name: "escape", label: t("common.close") }]} onAccessibilityAction={() => settleUndo(id)}>
          <Glass style={styles.toast} solid={styles.solid}>
            <Text style={styles.label} numberOfLines={2}>{offer.label}</Text>
            <Tap onPress={() => { void Haptics.selectionAsync(); takeUndo(id); }} hitSlop={10} style={styles.button} accessibilityRole="button">
              <Text style={styles.buttonText}>{t("misc.undo")}</Text>
            </Tap>
          </Glass>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { justifyContent: "flex-end", alignItems: "center", paddingHorizontal: S.lg },
  root: { maxWidth: 520, width: "100%" },
  shadow: { borderRadius: 26 },
  toast: { flexDirection: "row", alignItems: "center", gap: S.md, paddingLeft: S.lg, paddingRight: S.sm, minHeight: 52, borderRadius: 26 },
  // Below iOS 26 or with Reduce Transparency: the bottom bar's solid buttons.
  solid: { backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.separator, ...Elevation },
  label: { flex: 1, fontSize: 15, color: C.label },
  button: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: S.md },
  buttonText: { fontSize: 15, fontWeight: "700", color: C.tint },
}));
