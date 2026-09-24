import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { applyDigitWhole, applyKey, applyKeySigned, evalExpr, evalPartial, exprSign, formatExpr, hasOperator, negateExpr } from "@kopiyka/core";
import { C, R, S } from "@/constants/theme";
export { applyDigitWhole, applyKey, applyKeySigned, evalExpr, evalPartial, exprSign, formatExpr, hasOperator, negateExpr };

/**
 * Numeric keypad in the Control-app layout: an operator strip, then
 *   7 8 9 ⌫ / 4 5 6 C / 1 2 3 ± / 0 . [extra]
 * The native keyboard is never used for amounts.
 *
 * There is no "=" key. The amount field above always shows what the sum currently comes to, and the
 * sum itself is written out under it (`CalcLine`), so 90 − 30 reads as 60 with "90 − 30" beneath —
 * one less key to press, and nothing hidden behind pressing it.
 */
export interface KeypadProps {
  value: string;
  /** New expression, plus the key that produced it (omitted for Clear/long-press-clear) —
   *  callers that keep a signed expression (the Log sheet) use the key with `applyKeySigned`. */
  onChange: (expr: string, key?: string) => void;
  /** Optional bottom-right key (e.g. Category). */
  extra?: { label: string; a11y?: string; icon: React.ComponentProps<typeof SymbolView>["name"]; color?: string; active?: boolean; onPress: () => void };
  /** Small square key to the right of `extra` (e.g. Tags), shares its slot. */
  extra2?: { a11y: string; icon: React.ComponentProps<typeof SymbolView>["name"]; badge?: number; active?: boolean; onPress: () => void };
  /** Show the ± key (off for transfers/budgets). */
  allowSign?: boolean;
  /** Show the ± key greyed out instead of leaving its slot empty: the calculator that looks like the
   *  Log sheet's, where the sign is the caller's to decide rather than the keypad's. */
  signDisabled?: boolean;
  onToggleSign?: () => void;
}

const GRID: string[][] = [["7", "8", "9", "⌫"], ["4", "5", "6", "C"], ["1", "2", "3", "±"], ["0", ".", "extra"]];
const OPS = ["÷", "×", "−", "+"];

/**
 * A key that answers the tap. Two separate signals, because they say different things:
 *
 * - every key dips under the finger and springs back, so a tap that produced no change to the
 *   number (a second decimal point, a digit past two decimals) is still visibly a tap and not a
 *   dead button;
 * - a key that carries a state — the decimal point, Category, Tags — fades its lit background in
 *   and out instead of snapping, so "this is on now" is something you see happen rather than
 *   something you have to notice changed.
 *
 * Both run on the native driver (transform and opacity only), so they keep time with the finger
 * while the amount above is being recalculated.
 */
function AnimatedKey({ on, onPress, onLongPress, style, onStyle, a11y, a11yState, children }: {
  on?: boolean; onPress: () => void; onLongPress?: () => void;
  style: StyleProp<ViewStyle>; onStyle?: StyleProp<ViewStyle>;
  a11y: string; a11yState?: { selected?: boolean; disabled?: boolean }; children: ReactNode;
}) {
  // `useState` rather than a ref: the value is created once either way, and reading `ref.current`
  // during render is exactly what the refs lint rule is there to stop.
  const [scale] = useState(() => new Animated.Value(1));
  const [lit] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => { Animated.timing(lit, { toValue: on ? 1 : 0, duration: 160, useNativeDriver: true }).start(); }, [on, lit]);
  const to = (v: number, speed: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed, bounciness: v === 1 ? 10 : 0 }).start();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} onPressIn={() => to(0.93, 40)} onPressOut={() => to(1, 20)}
      accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={a11yState}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {onStyle ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, onStyle, { opacity: lit }]} /> : null}
        {children}
      </Animated.View>
    </Pressable>
  );
}

export const Keypad = memo(function Keypad({ value, onChange, extra, extra2, allowSign = true, signDisabled, onToggleSign }: KeypadProps) {
  // The decimal point applies to the number being typed — the part after the last operator — so
  // that tail is what says whether it has been pressed.
  const tail = value.split(/[+−×÷]/).pop() ?? "";
  /**
   * Which half of the number the next digit belongs to. Lit means cents; pressing the point again
   * puts the finger back on the whole units ("12.34" and then 5 is 125.34) and the light goes out,
   * so the key still answers every press without ever deleting the cents — which are usually the
   * part that was right. A third press lights it again.
   *
   * State, because it is the one thing the expression cannot say: "12.34" looks identical whether
   * the next digit is a zloty or a grosz. It is kept honest by `tail` rather than by an effect —
   * a number with no point has no two halves to choose between, so the flag simply stops counting.
   */
  const [onWhole, setOnWhole] = useState(false);
  const wholeFocus = onWhole && tail.includes(".");
  const dotOn = tail.includes(".") && !wholeFocus;
  const press = useCallback((k: string) => {
    void Haptics.selectionAsync();
    if (k === "±") { onToggleSign?.(); return; }
    if (k === "C") {
      if (!value) return;
      Alert.alert("Clear amount?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Clear", style: "destructive", onPress: () => { setOnWhole(false); onChange(""); } }]);
      return;
    }
    const decimals = (value.split(/[+−×÷]/).pop() ?? "").includes(".");
    if (k === ".") { if (decimals) { setOnWhole((w) => !w); return; } setOnWhole(false); }
    else if (/^\d$/.test(k) && onWhole && decimals) {
      // The caller is handed the finished expression and no key: `applyKeySigned` would append this
      // digit at the end again, and there is nothing to sign — an expression with a decimal point
      // in it already carries whatever sign it was given.
      onChange(applyDigitWhole(value, k));
      return;
    } else setOnWhole(false);
    onChange(applyKey(value, k), k);
  }, [value, onChange, onToggleSign, onWhole]);
  return (
    <View style={styles.wrap}>
      <View style={styles.ops}>
        {OPS.map((o) => <Pressable key={o} onPress={() => press(o)} accessibilityRole="button" accessibilityLabel={o === "÷" ? "Divide" : o === "×" ? "Multiply" : o === "−" ? "Subtract" : "Add"} style={({ pressed }) => [styles.op, pressed && styles.pressed]}><Text style={styles.opText} maxFontSizeMultiplier={1.3}>{o}</Text></Pressable>)}
      </View>
      {GRID.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => {
            if (k === "extra") {
              if (!extra) return <View key="extra" style={[styles.key, { flex: 2.08, backgroundColor: "transparent" }]} />;
              const main = (
                <Pressable key="extra" onPress={extra.onPress} accessibilityRole="button" accessibilityLabel={extra.a11y ?? extra.label}
                  style={({ pressed }) => [styles.key, styles.extra, extra2 && { flex: 1 }, extra.active && [styles.extraActive, extra.color ? { backgroundColor: extra.color + "33", borderColor: extra.color } : null], pressed && styles.pressed]}>
                  <SymbolView name={extra.icon} size={20} tintColor={extra.active ? extra.color ?? C.onTint : C.tint} />
                  <Text numberOfLines={1} style={[styles.extraText, extra.active && { color: extra.color ?? C.onTint }]} maxFontSizeMultiplier={1.3}>{extra.label}</Text>
                </Pressable>
              );
              if (!extra2) return main;
              return (
                <View key="extra" style={[styles.key, { flex: 2.08, backgroundColor: "transparent", flexDirection: "row", gap: S.sm }]}>
                  {main}
                  <Pressable onPress={extra2.onPress} accessibilityRole="button" accessibilityLabel={extra2.a11y}
                    style={({ pressed }) => [styles.key, styles.small, extra2.active && styles.smallActive, pressed && styles.pressed]}>
                    <SymbolView name={extra2.icon} size={20} tintColor={extra2.active ? C.onTint : C.tint} />
                    {extra2.badge ? <Text style={[styles.smallBadge, extra2.active && { color: C.onTint }]}>{extra2.badge}</Text> : null}
                  </Pressable>
                </View>
              );
            }
            const wide = k === "0";
            const fn = k === "⌫" || k === "C" || k === "±";
            if (k === "±" && signDisabled) return (
              <View key={k} style={[styles.keySlot, styles.key, { opacity: 0.35 }]} accessible accessibilityRole="button" accessibilityLabel="Change sign" accessibilityState={{ disabled: true }}>
                <SymbolView name="plus.forwardslash.minus" size={20} tintColor={C.label} />
              </View>
            );
            if (k === "±" && !allowSign) return <View key={k} style={styles.key} />;
            const dot = k === ".";
            return (
              <View key={k} style={wide ? styles.wide : styles.keySlot}>
                <AnimatedKey on={dot && dotOn} onPress={() => press(k)} onLongPress={k === "⌫" ? () => { setOnWhole(false); onChange(""); } : undefined}
                  style={styles.key} onStyle={dot ? styles.dotKey : undefined}
                  a11y={k === "⌫" ? "Delete" : k === "C" ? "Clear" : k === "±" ? "Change sign" : dot ? (dotOn ? "Decimal point, typing decimals" : tail.includes(".") ? "Decimal point, typing whole units" : "Decimal point") : k}
                  a11yState={dot ? { selected: dotOn } : undefined}>
                  {k === "⌫" ? <SymbolView name="delete.left" size={22} tintColor={C.label} />
                    : k === "±" ? <SymbolView name="plus.forwardslash.minus" size={20} tintColor={C.label} />
                    : <Text style={[styles.keyText, k === "C" && styles.clear, fn && styles.fnText, dot && dotOn && styles.dotText]} maxFontSizeMultiplier={1.3}>{k}</Text>}
                </AnimatedKey>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
});

/**
 * The sum being typed, written out under the amount field: "90 − 30" while the field itself already
 * reads 60. Blank (but still occupying its line, so nothing jumps) when the amount is a plain number.
 * One line, shrinking to fit, because a long sum must stay readable next to a large amount.
 */
export function CalcLine({ expr, style }: { expr: string; style?: StyleProp<TextStyle> }) {
  const calc = formatExpr(expr);
  return <Text style={[styles.calc, style]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityLabel={calc || undefined}>{calc || " "}</Text>;
}

/** Full-width tap-to-add button: the value and the action, nothing that looks like a slider. */
export function ConfirmBar({ amount, label, onPress, disabled, color }: { amount: string; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <Pressable onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}, ${amount}`} accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.confirm, color ? { backgroundColor: color } : null, (pressed || disabled) && { opacity: 0.55 }]}>
      <Text style={[styles.confirmAmount, !color && { color: C.onTint }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>{amount}</Text>
      <Text style={[styles.confirmLabel, !color && { color: C.onTint, opacity: 0.8 }]} maxFontSizeMultiplier={1.4}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: S.sm, paddingHorizontal: S.md },
  ops: { flexDirection: "row", gap: S.sm },
  op: { flex: 1, minHeight: 36, borderRadius: R.sm + 2, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  opText: { fontSize: 20, color: C.tint, fontWeight: "600" },
  calc: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"], minHeight: 20, textAlign: "center" },
  row: { flexDirection: "row", gap: S.sm },
  keySlot: { flex: 1 },
  key: { minHeight: 50, borderRadius: R.md, alignItems: "center", justifyContent: "center", backgroundColor: C.fill, overflow: "hidden" },
  wide: { flex: 1 },
  pressed: { opacity: 0.55 },
  keyText: { fontSize: 27, fontWeight: "500", color: C.label, fontVariant: ["tabular-nums"] },
  fnText: { fontSize: 22 },
  clear: { color: C.orange, fontWeight: "600" },
  // The same "this key is on" language as the Category and Tags keys below it.
  dotKey: { backgroundColor: C.tint, borderRadius: R.md },
  dotText: { color: C.onTint, fontWeight: "700" },
  extra: { flex: 2.08, flexDirection: "row", borderWidth: 1.5, borderStyle: "dashed", borderColor: C.tint, backgroundColor: "transparent", gap: 6, paddingHorizontal: 8 },
  extraActive: { backgroundColor: C.tint, borderStyle: "solid" },
  extraText: { fontSize: 14, color: C.tint, fontWeight: "600", flexShrink: 1 },
  small: { flex: 0, width: 50, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.tint, backgroundColor: "transparent", flexDirection: "row", gap: 2 },
  smallActive: { backgroundColor: C.tint, borderStyle: "solid" },
  smallBadge: { fontSize: 13, fontWeight: "700", color: C.tint },
  confirm: { marginHorizontal: S.md, minHeight: 56, paddingVertical: 8, borderRadius: 16, backgroundColor: C.tint, alignItems: "center", justifyContent: "center", gap: 1 },
  confirmAmount: { color: "white", fontSize: 19, fontWeight: "700", fontVariant: ["tabular-nums"] },
  confirmLabel: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
});
