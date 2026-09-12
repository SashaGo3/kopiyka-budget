import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, useColorScheme, useWindowDimensions, type ColorValue, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { Brand, C, Elevation, R } from "@/constants/theme";
import { Glass, GlassGroup, useGlass } from "@/components/glass";
import { RECEIPT_SCANNER_ENABLED } from "@/constants/features";
import { newPickKey, usePickResult } from "@/store/pick";
import type { ReceiptParse } from "@/lib/bridge";

/**
 * Floating controls in the thumb zone: bottom left of the screen, where a right hand reaches most
 * easily. The first child is nearest the thumb, and buttons that do not fit wrap onto a second line.
 *
 * This used to mirror to the right for left-handed people, behind a Handedness preference. The
 * setting was removed in 2026-09: it bought one rarely-changed choice at the price of every bottom
 * bar in the app being laid out twice.
 */
export function BottomBar({ children, above, style, visible = true }: { children: ReactNode; above?: ReactNode; style?: StyleProp<ViewStyle>; visible?: boolean }) {
  const glass = useGlass();
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => { Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 220, useNativeDriver: true }).start(); }, [visible, anim]);
  // Hidden is 0.02 rather than 0 while glass is on: opacity 0 on a glass view or any ancestor
  // switches the material off natively and it does not come back. The bar is translated clear
  // of the screen anyway, so the floor is never visible.
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [glass ? 0.02 : 0, 1] });
  return (
    <Animated.View pointerEvents={visible ? "box-none" : "none"} style={[styles.wrap, styles.alignLeft, style,
      { opacity, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) }] }]}>
      {above}
      {/* Grouped so buttons that come within `spacing` of each other bleed into one capsule, the way an iOS 26 toolbar does. */}
      <GlassGroup spacing={14} style={styles.row}>{children}</GlassGroup>
    </Animated.View>
  );
}

/**
 * Hide the bar while scrolling down and bring it back on the way up, like the native
 * tab bar. Attach `onScroll` to the screen's list (scrollEventThrottle 16).
 */
export function useScrollHide(): { visible: boolean; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void } {
  const [visible, setVisible] = useState(true);
  const last = useRef(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const max = Math.max(0, e.nativeEvent.contentSize.height - e.nativeEvent.layoutMeasurement.height);
    const dy = y - last.current;
    last.current = y;
    if (y <= 0) setVisible(true);                 // back at the top: like the native tab bar
    else if (y > max) return;                     // bouncing at the bottom changes nothing
    else if (dy > 6) setVisible(false);
    else if (dy < -6) setVisible(true);
  }, []);
  return { visible, onScroll };
}

/**
 * Primary LOG action, half the screen wide so it is hard to miss with a thumb. Tap opens the
 * entry sheet (Expense / Income / Transfer is chosen there). With the receipt scanner enabled a
 * long press photographs a receipt first and opens the sheet prefilled from it.
 */
export function LogButton({ account }: { account?: string } = {}) {
  const { width } = useWindowDimensions();
  // Glass takes a plain colour, so the accent is resolved by hand here rather than through
  // C.tint, which is a DynamicColorIOS value. Tinted this strongly it keeps the pill reading
  // black-on-light / white-on-dark as before, and only gains the glass edge and refraction.
  const tint = useColorScheme() === "dark" ? Brand.accentDark : Brand.accent;
  const [key] = useState(() => newPickKey("logreceipt"));
  usePickResult<ReceiptParse>(key, useCallback((r: ReceiptParse) => {
    setTimeout(() => router.push({ pathname: "/transaction/[id]", params: { id: "new", kind: "expense", receipt: JSON.stringify(r), ...(account ? { account } : {}) } }), 350);
  }, [account]));
  const scan = RECEIPT_SCANNER_ENABLED ? () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push({ pathname: "/receipt/scan", params: { key } }); } : undefined;
  return (
    <Pressable
      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: "/transaction/[id]", params: { id: "new", kind: "expense", ...(account ? { account } : {}) } }); }}
      onLongPress={scan}
      style={({ pressed }) => [styles.fab, { width: Math.round(width / 2) }, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Log a transaction" accessibilityHint={scan ? "Long press to photograph a receipt" : undefined}>
      <Glass style={styles.fabFill} solid={styles.fabSolid} tint={tint} interactive />
      <SymbolView name="plus" size={22} tintColor={C.onTint} weight="bold" />
      <Text style={styles.text} maxFontSizeMultiplier={1.4}>Log</Text>
    </Pressable>
  );
}

/**
 * Secondary round/pill button for the bar (sort, filter, add, multi-edit actions). A glass
 * surface on iOS 26 (a white card below it) with a `C.tint` icon/label, so it never competes
 * with the Log pill. No border: against glass a drawn ring reads as a hard edge the material
 * does not have. `active` needs none either — each button already says it in its own content
 * (the filter button shows the count, the sort button swaps its icon), so `active` only bolds
 * the label and sets the accessibility state. `color` tints the icon (e.g. red for Delete).
 *
 * The glass sits behind the content as an absolute fill rather than wrapping it: the ring and
 * the press transform then live on the Pressable and behave the same with or without glass.
 */
export function BarButton({ icon, label, onPress, active, a11y, color }: { icon: SFSymbol; label?: string; onPress: () => void; active?: boolean; a11y: string; color?: ColorValue }) {
  const tint = color ?? C.tint;
  return (
    <Pressable onPress={() => { void Haptics.selectionAsync(); onPress(); }} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
      <Glass style={styles.btnFill} solid={styles.btnSolid} interactive />
      <SymbolView name={icon} size={20} tintColor={tint} weight="semibold" />
      {label ? <Text numberOfLines={1} style={[styles.btnText, { color: tint }, active && styles.btnTextActive]} maxFontSizeMultiplier={1.4}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, bottom: 96, gap: 10 },
  alignLeft: { alignItems: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  fab: { minHeight: 56, paddingHorizontal: 20, borderRadius: R.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  fabFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: R.pill },
  fabSolid: { backgroundColor: C.tint, ...Elevation },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
  text: { color: C.onTint, fontSize: 17, fontWeight: "700" },
  btn: { minWidth: 52, minHeight: 52, paddingHorizontal: 14, borderRadius: R.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, maxWidth: 190, position: "relative" },
  btnFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: R.pill },
  btnSolid: { backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.separator, ...Elevation },
  btnText: { color: C.tint, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  btnTextActive: { fontWeight: "700" },
});
