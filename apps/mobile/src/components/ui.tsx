import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Switch, Text, View, type ColorValue, type LayoutChangeEvent, type StyleProp, type ViewStyle, type TextStyle } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, S } from "@/constants/theme";
import { iconFor, tagColor } from "@kopiyka/core";

/** Sheet skeleton: informational top, inputs pinned to the bottom. */
export function SheetFrame({ top, bottom, onLayout }: { top: ReactNode; bottom: ReactNode; onLayout?: (e: LayoutChangeEvent) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: C.bgGrouped }} onLayout={onLayout}>
      <View>{top}</View>
      <View style={{ paddingBottom: Math.max(insets.bottom, S.md), paddingTop: S.md, gap: S.md }}>{bottom}</View>
    </View>
  );
}

export function Title({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text style={[styles.title, style]} numberOfLines={numberOfLines}>{children}</Text>;
}
export function Subtle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.subtle, style]}>{children}</Text>;
}

export function Chip({ label, icon, active, onPress, tint, compact }: { label: string; icon?: SFSymbol; active?: boolean; onPress?: () => void; tint?: string; compact?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} style={({ pressed }) => [styles.chip, compact && styles.chipCompact, active && styles.chipActive, pressed && { opacity: 0.6 }]}>
      {icon ? <SymbolView name={icon} size={15} tintColor={active ? C.onTint : tint ?? C.tint} /> : null}
      <Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]} ellipsizeMode="middle">{label}</Text>
    </Pressable>
  );
}

/** SF Symbol for an account type. */
export function accountIcon(type: string): SFSymbol {
  switch (type) {
    case "cash": return "banknote";
    case "card": return "creditcard";
    case "investment": return "chart.line.uptrend.xyaxis";
    case "savings": return "building.columns";
    default: return "building.columns.fill";
  }
}

/** Amount pill like Budget Flow: red tint for expenses, green for income. */
export function AmountPill({ minor, currency, neutral }: { minor: number; currency: string; neutral?: boolean }) {
  const neg = minor < 0;
  return (
    <View style={[styles.pill, neutral ? styles.pillNeutral : neg ? styles.pillNeg : styles.pillPos]}>
      <Money minor={minor} currency={currency} style={[styles.pillText, { color: neutral ? C.label : neg ? C.red : C.green }]} sign={!neutral && !neg} />
    </View>
  );
}

/** Wrapping row of chips. Used inside form sheets, where a ScrollView would be hoisted by react-native-screens. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; color?: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: on }} style={[styles.segItem, on && styles.segOn]}>
            <Text style={[styles.segText, on && { color: o.color ?? C.label, fontWeight: "600" }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ title, subtitle, subtitleColor, left, right, onPress, icon, iconColor, destructive, style }: {
  title: string; subtitle?: string; subtitleColor?: ColorValue; left?: ReactNode; right?: ReactNode; onPress?: () => void; icon?: SFSymbol; iconColor?: string; destructive?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.fill }, style]}>
      {left ?? (icon ? <View style={[styles.iconBox, { backgroundColor: iconColor ?? C.tint }]}><SymbolView name={icon} size={16} tintColor={iconColor ? "white" : C.onTint} /></View> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[styles.rowTitle, destructive && { color: C.red }]}>{title}</Text>
        {subtitle ? <Text numberOfLines={3} style={[styles.rowSub, subtitleColor && { color: subtitleColor }]}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && !right ? <SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /> : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <Text style={styles.sectionText}>{children}</Text>
      {right}
    </View>
  );
}

export function Money({ minor, currency, style, colored, sign, approx }: { minor: number; currency: string; style?: StyleProp<TextStyle>; colored?: boolean; sign?: boolean; approx?: boolean }) {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const d = 2;
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = String(abs % 100).padStart(d, "0");
  const color = colored ? (neg ? C.label : C.green) : C.label;
  return (
    <Text style={[styles.money, { color }, style]} maxFontSizeMultiplier={1.6}>
      {approx ? "≈" : ""}{neg ? "−" : sign ? "+" : ""}{int}.{frac} <Text style={{ opacity: 0.55, fontSize: 13 }}>{currency}</Text>
    </Text>
  );
}

/** Progress bar whose fill eases to its value; `ratio` 0..1. */
export function ProgressBar({ ratio, color, height = 6 }: { ratio: number; color: string | ColorValue; height?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(anim, { toValue: Math.max(0, Math.min(1, ratio)), duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, [ratio, anim]);
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: C.fill, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}>
      <Animated.View style={{ height, borderRadius: height / 2, backgroundColor: color, width: anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
    </View>
  );
}

/** Fades and lifts its children in on mount (cards, list groups). */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(anim, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(); }, [anim, delay]);
  return <Animated.View style={[style, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{children}</Animated.View>;
}

/** Small tag pill: visibly different from note text. */
export function TagPill({ name, color, onPress }: { name: string; color?: string | null; onPress?: () => void }) {
  // No colour of its own: one derived from the name, so a row of tags is not a row of identical pills.
  const tint = tagColor(name, color);
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`Tag ${name}`} style={[styles.tag, { backgroundColor: tint + "22", borderColor: tint + "55" }]}>
      <Text style={[styles.tagText, { color: tint }]} numberOfLines={1}>#{name}</Text>
    </Pressable>
  );
}

/** Plain header for card modals: text actions only, no native glass bubbles. */
export function ModalHeader({ title, left, right }: { title: string; left?: { label: string; onPress: () => void }; right?: { label: string; onPress: () => void; disabled?: boolean; bold?: boolean } }) {
  return (
    <View style={styles.modalHeader}>
      <View style={styles.modalSide}>{left ? <Pressable onPress={left.onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={left.label}><Text style={styles.modalLink}>{left.label}</Text></Pressable> : null}</View>
      <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
      <View style={[styles.modalSide, { alignItems: "flex-end" }]}>{right ? <Pressable onPress={right.onPress} disabled={right.disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={right.label} accessibilityState={{ disabled: !!right.disabled }}><Text style={[styles.modalLink, right.bold !== false && { fontWeight: "700" }, right.disabled && { opacity: 0.4 }]}>{right.label}</Text></Pressable> : null}</View>
    </View>
  );
}

/** Row with a native switch; the whole row toggles it too. */
export function ToggleRow({ title, subtitle, value, onChange, icon, iconColor, style }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; icon?: SFSymbol; iconColor?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Row title={title} subtitle={subtitle} icon={icon} iconColor={iconColor} onPress={() => onChange(!value)} style={style}
      right={<Switch value={value} onValueChange={onChange} accessibilityLabel={title} />} />
  );
}

/** Red text row for destructive actions, placed under the confirm bar. */
export function DeleteRow({ label, onPress, icon = "trash" }: { label: string; onPress: () => void; icon?: SFSymbol }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.5 }]}>
      <SymbolView name={icon} size={15} tintColor={C.red} />
      <Text style={styles.deleteText}>{label}</Text>
    </Pressable>
  );
}

/** Category icon box using the auto-matched or explicit symbol. */
export function CategoryIcon({ name, icon, color, size = 30 }: { name: string; icon?: string | null; color?: string | null; size?: number }) {
  const m = iconFor(name, { icon: icon ?? null, color: color ?? null });
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: m.color + "26", alignItems: "center", justifyContent: "center" }}>
      <SymbolView name={m.icon as SFSymbol} size={size * 0.55} tintColor={m.color} />
    </View>
  );
}

/**
 * Several category icons as one overlapping stack, for something that covers more than one category
 * (a budget over a set of them). Each tile keeps its own icon and colour and is cut out of the
 * background behind it, so the pile reads as a pile rather than as one smudged tile.
 *
 * A folder stands for itself here: it arrives as one entry wearing its own icon, never expanded into
 * whatever is inside it — the whole point of scoping a budget to a folder is that its contents are
 * not a list you maintain. One entry is drawn exactly as `CategoryIcon` would draw it.
 */
export function CategoryIconStack({ items, size = 30, max = 3, cutout = C.card }: {
  items: { name: string; icon?: string | null; color?: string | null }[]; size?: number; max?: number; cutout?: ColorValue;
}) {
  const shown = items.slice(0, max);
  if (shown.length <= 1) return <CategoryIcon name={shown[0]?.name ?? "?"} icon={shown[0]?.icon} color={shown[0]?.color} size={size} />;
  // Each tile after the first is shrunk a little and slid over the one before it.
  const tile = size * 0.78;
  const step = tile * 0.62;
  return (
    <View style={{ width: step * (shown.length - 1) + tile, height: size, justifyContent: "center" }}>
      {shown.map((it, i) => {
        const m = iconFor(it.name, { icon: it.icon ?? null, color: it.color ?? null });
        return (
          <View key={`${it.name}-${i}`} style={{
            position: "absolute", left: i * step, width: tile, height: tile, borderRadius: tile * 0.28,
            backgroundColor: m.color + "26", alignItems: "center", justifyContent: "center",
            // The ring is the background showing through, which is what makes the overlap legible.
            borderWidth: i ? 1.5 : 0, borderColor: cutout,
          }}>
            <SymbolView name={m.icon as SFSymbol} size={tile * 0.55} tintColor={m.color} />
          </View>
        );
      })}
    </View>
  );
}

export function BigButton({ label, onPress, destructive, disabled }: { label: string; onPress: () => void; destructive?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.big, destructive && { backgroundColor: C.red }, (pressed || disabled) && { opacity: 0.5 }]}>
      <Text style={styles.bigText}>{label}</Text>
    </Pressable>
  );
}

/**
 * The pair of totals that tops Budgets (Planned / Available) and Transactions (Income / Expenses).
 * The label is set small and tracked like a section header so the number, not the caption, is
 * what the eye lands on first.
 */
export function StatPair({ stats }: { stats: { label: string; minor: number; currency: string; color?: ColorValue; approx?: boolean }[] }) {
  return (
    <View style={styles.stats}>
      {stats.map((s) => (
        <View key={s.label} style={styles.stat}>
          <Text style={styles.statLabel} maxFontSizeMultiplier={1.4}>{s.label}</Text>
          <Money minor={s.minor} currency={s.currency} approx={s.approx} style={[styles.statValue, s.color ? { color: s.color } : null]} />
        </View>
      ))}
    </View>
  );
}

/**
 * What a screen is for, in one or two sentences, above its list.
 *
 * These explanations used to live in the empty state, which meant they vanished the moment the
 * screen had anything on it — exactly when someone opening it for the second time is still working
 * out what a tag is for, or how a manual recurring rule differs from an automatic one. So the note
 * stays, and the empty state is left to say only that the list is empty.
 */
export function ScreenNote({ children }: { children: ReactNode }) {
  return <Text style={styles.screenNote}>{children}</Text>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ padding: S.xxl, alignItems: "center", gap: S.sm }}>
      <Text style={{ color: C.secondary, fontSize: 17, fontWeight: "600" }}>{title}</Text>
      {hint ? <Text style={{ color: C.tertiary, textAlign: "center" }}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screenNote: { color: C.tertiary, fontSize: 13, lineHeight: 18, paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.xs },
  title: { fontSize: 22, fontWeight: "700", color: C.label },
  subtle: { fontSize: 14, color: C.secondary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: S.sm, paddingHorizontal: S.md },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pillNeg: { backgroundColor: "rgba(255,59,48,0.14)" },
  pillPos: { backgroundColor: "rgba(52,199,89,0.14)" },
  pillNeutral: { backgroundColor: C.fill },
  pillText: { fontSize: 15, fontWeight: "600" },
  chip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, minHeight: 38, paddingVertical: 6, borderRadius: 19, backgroundColor: C.fill, flexGrow: 1, flexBasis: "auto", minWidth: 0, maxWidth: "100%" },
  chipCompact: { flexGrow: 0, flexBasis: "auto", minWidth: 0 },
  chipActive: { backgroundColor: C.tint },
  chipText: { color: C.label, fontSize: 15, fontWeight: "500" },
  chipTextActive: { color: C.onTint },
  seg: { flexDirection: "row", backgroundColor: C.fill, borderRadius: R.sm + 2, padding: 2, alignSelf: "stretch" },
  segItem: { flex: 1, minHeight: 32, paddingVertical: 4, alignItems: "center", justifyContent: "center", borderRadius: R.sm },
  segOn: { backgroundColor: C.card },
  segText: { color: C.secondary, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: 8, minHeight: 50, backgroundColor: C.card },
  rowTitle: { fontSize: 17, color: C.label },
  rowSub: { fontSize: 13, color: C.secondary, marginTop: 1 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: C.card, borderRadius: R.md, overflow: "hidden", marginHorizontal: S.lg },
  stats: { flexDirection: "row", gap: S.md, paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.sm },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: R.card, paddingHorizontal: S.md, paddingVertical: 10, gap: 3 },
  statLabel: { color: C.secondary, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 20, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.sm },
  sectionText: { fontSize: 13, color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4 },
  money: { fontSize: 17, fontVariant: ["tabular-nums"], fontWeight: "500" },
  deleteRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40 },
  tag: { paddingHorizontal: 8, minHeight: 24, paddingVertical: 2, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", maxWidth: 200 },
  tagText: { fontSize: 13, fontWeight: "600" },
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: S.lg, minHeight: 52 },
  modalSide: { width: 70 },
  modalTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600", color: C.label },
  modalLink: { color: C.tint, fontSize: 17 },
  deleteText: { color: C.red, fontSize: 15, fontWeight: "500" },
  big: { marginHorizontal: S.md, minHeight: 50, paddingVertical: 10, borderRadius: R.md, backgroundColor: C.tint, alignItems: "center", justifyContent: "center" },
  bigText: { color: C.onTint, fontSize: 18, fontWeight: "600" },
});
