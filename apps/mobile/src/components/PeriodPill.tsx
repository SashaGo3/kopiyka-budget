import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { C, R, themed } from "@/constants/theme";
import { Glass } from "@/components/glass";
import type { Period } from "@/lib/period";
import { t } from "@/i18n";

/**
 * "Aug 2026" with "15 Aug – 14 Sep" underneath when periods start mid-month. Tap opens the month
 * picker, long-press returns to today. Glass in both homes it has — floating over the Budgets
 * list, and in the Transactions nav bar, where the native header buttons beside it are glass
 * capsules themselves and a solid pill reads as a flat white blob next to them.
 *
 * The arrows are buttons of their own, round and a thumb wide, with a gap between them and the
 * month: inside the pill they were small chevrons a few points from the label, and a tap meant for
 * the next month opened the picker as often as not. Leave `onPrev`/`onNext` out for a pill that only
 * picks (Insights, where stepping month by month is not what the screen is for).
 */
export function PeriodPill({ period, onPrev, onNext, onReset, onPick, disabled }: { period: Period; onPrev?: () => void; onNext?: () => void; onReset?: () => void; onPick?: () => void; disabled?: boolean }) {
  const arrow = (dir: "left" | "right", onPress: () => void) => (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4} accessibilityRole="button" accessibilityLabel={dir === "left" ? t("period.pill.previous") : t("period.pill.next")}
      style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}>
      <Glass style={styles.round} solid={styles.solid} interactive />
      <SymbolView name={dir === "left" ? "chevron.left" : "chevron.right"} size={15} tintColor={C.tint} weight="semibold" />
    </Pressable>
  );
  const arrows = !!(onPrev && onNext);
  return (
    <View style={[styles.row, disabled && { opacity: 0.4 }]} accessibilityLabel={period.subtitle ? t("period.pill.labelRange", { title: period.title, range: period.subtitle }) : t("period.pill.label", { title: period.title })}>
      {onPrev ? arrow("left", onPrev) : null}
      <Pressable onPress={onPick} onLongPress={onReset} disabled={disabled} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t("period.pill.choose", { title: period.title })} accessibilityHint={t("period.pill.chooseHint")}>
        <Glass style={styles.fill} solid={styles.solid} interactive />
        <View style={{ alignItems: "center" }}>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>{period.title}</Text>
          {period.subtitle ? <Text style={styles.sub} maxFontSizeMultiplier={1.3}>{period.subtitle}</Text> : null}
        </View>
        {arrows ? null : <SymbolView name="chevron.down" size={10} tintColor={C.tertiary} />}
      </Pressable>
      {onNext ? arrow("right", onNext) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  arrow: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  round: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 19 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: R.pill, paddingHorizontal: 14, minHeight: 38, paddingVertical: 3, maxWidth: 200, flexShrink: 1 },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: R.pill },
  solid: { backgroundColor: C.fill },
  title: { fontSize: 15, fontWeight: "600", color: C.label },
  sub: { fontSize: 11, color: C.secondary, marginTop: -1 },
}));
