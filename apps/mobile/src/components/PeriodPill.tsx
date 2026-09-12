import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { C, R } from "@/constants/theme";
import { Glass } from "@/components/glass";
import type { Period } from "@/lib/period";

/**
 * "Aug 2026" with "15 Aug – 14 Sep" underneath when periods start mid-month. Tap opens the month
 * picker, long-press returns to today. Glass in both homes it has — floating over the Budgets
 * list, and in the Transactions nav bar, where the native header buttons beside it are glass
 * capsules themselves and a solid pill reads as a flat white blob next to them.
 */
export function PeriodPill({ period, onPrev, onNext, onReset, onPick, disabled }: { period: Period; onPrev: () => void; onNext: () => void; onReset?: () => void; onPick?: () => void; disabled?: boolean }) {
  return (
    <View style={[styles.pill, disabled && { opacity: 0.4 }]} accessibilityRole="adjustable" accessibilityLabel={`Period ${period.title}${period.subtitle ? `, ${period.subtitle}` : ""}`}>
      <Glass style={styles.fill} solid={styles.solid} />
      <Pressable onPress={onPrev} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous period"><SymbolView name="chevron.left" size={14} tintColor={C.tint} /></Pressable>
      <Pressable onPress={onPick} onLongPress={onReset} disabled={disabled} style={{ alignItems: "center" }} accessibilityRole="button" accessibilityLabel={`${period.title}, choose month`} accessibilityHint="Long press for today">
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>{period.title}</Text>
        {period.subtitle ? <Text style={styles.sub} maxFontSizeMultiplier={1.3}>{period.subtitle}</Text> : null}
      </Pressable>
      <Pressable onPress={onNext} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next period"><SymbolView name="chevron.right" size={14} tintColor={C.tint} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: R.pill, paddingHorizontal: 10, minHeight: 34, paddingVertical: 3, maxWidth: 260 },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: R.pill },
  solid: { backgroundColor: C.fill },
  title: { fontSize: 15, fontWeight: "600", color: C.label },
  sub: { fontSize: 11, color: C.secondary, marginTop: -1 },
});
