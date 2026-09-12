import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { C, R } from "@/constants/theme";
import { Glass } from "@/components/glass";

/** Header pill showing which accounts Budgets (and Transactions) are looking at; tap to change. */
export function ScopePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Spending from ${label}`} accessibilityHint="Choose an account or group"
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.6 }]}>
      {/* Active (a specific account chosen) is an opaque tint pill, so it reads as a committed filter rather than chrome. */}
      {active ? <View style={[styles.fill, styles.activeFill]} /> : <Glass style={styles.fill} solid={styles.solid} interactive />}
      <SymbolView name="creditcard" size={14} tintColor={active ? C.onTint : C.tint} weight="semibold" />
      <Text numberOfLines={1} style={[styles.text, active && { color: C.onTint }]} maxFontSizeMultiplier={1.3}>{label}</Text>
      <SymbolView name="chevron.down" size={10} tintColor={active ? C.onTint : C.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: R.pill, paddingHorizontal: 12, minHeight: 34, paddingVertical: 3, maxWidth: 180 },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: R.pill },
  solid: { backgroundColor: C.fill },
  activeFill: { backgroundColor: C.tint },
  text: { fontSize: 15, fontWeight: "600", color: C.tint, flexShrink: 1 },
});
