import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { onUndoOffer, settleUndo, takeUndo, type UndoOffer } from "@/lib/undo";
import { Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/** How long the way back stays open. Long enough to read, short enough not to linger. */
const UNDO_MS = 5000;

/**
 * The toast an `offerUndo` shows, once, at the root of the app: above the tab bar, over whatever
 * screen the action left you on. Reanimated's entering and exiting animations follow the system's
 * Reduce Motion setting on their own, so it simply appears and goes there.
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
      <Animated.View key={offer.id} entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(160)} style={styles.toast}
        accessibilityLiveRegion="polite" accessible={false}>
        <Text style={styles.label} numberOfLines={2}>{offer.label}</Text>
        <Tap onPress={() => { void Haptics.selectionAsync(); takeUndo(offer.id); }} hitSlop={10} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>{t("misc.undo")}</Text>
        </Tap>
      </Animated.View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { justifyContent: "flex-end", alignItems: "center", paddingHorizontal: S.lg },
  toast: { flexDirection: "row", alignItems: "center", gap: S.md, maxWidth: 520, width: "100%", paddingLeft: S.lg, paddingRight: S.sm, minHeight: 52, borderRadius: 26, backgroundColor: C.label },
  label: { flex: 1, fontSize: 15, color: C.bg },
  button: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: S.md },
  buttonText: { fontSize: 15, fontWeight: "700", color: C.tint },
}));
