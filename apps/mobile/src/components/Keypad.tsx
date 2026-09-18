import { memo, useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { applyKey, applyKeySigned, evalExpr, evalPartial, exprSign, formatExpr, hasOperator, negateExpr } from "@kopiyka/core";
import { useT } from "@/i18n";
import { C, R, S } from "@/constants/theme";
export { applyKey, applyKeySigned, evalExpr, evalPartial, exprSign, formatExpr, hasOperator, negateExpr };

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
  onToggleSign?: () => void;
}

const GRID: string[][] = [["7", "8", "9", "⌫"], ["4", "5", "6", "C"], ["1", "2", "3", "±"], ["0", ".", "extra"]];
const OPS = ["÷", "×", "−", "+"];

export const Keypad = memo(function Keypad({ value, onChange, extra, extra2, allowSign = true, onToggleSign }: KeypadProps) {
  const t = useT();
  const press = useCallback((k: string) => {
    void Haptics.selectionAsync();
    if (k === "±") { onToggleSign?.(); return; }
    if (k === "C") {
      if (!value) return;
      Alert.alert(t("Clear amount?"), undefined, [{ text: t("Cancel"), style: "cancel" }, { text: t("Clear"), style: "destructive", onPress: () => onChange("") }]);
      return;
    }
    onChange(applyKey(value, k), k);
  }, [value, onChange, onToggleSign, t]);
  return (
    <View style={styles.wrap}>
      <View style={styles.ops}>
        {OPS.map((o) => <Pressable key={o} onPress={() => press(o)} accessibilityRole="button" accessibilityLabel={o === "÷" ? t("Divide") : o === "×" ? t("Multiply") : o === "−" ? t("Subtract") : t("Add")} style={({ pressed }) => [styles.op, pressed && styles.pressed]}><Text style={styles.opText} maxFontSizeMultiplier={1.3}>{o}</Text></Pressable>)}
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
            if (k === "±" && !allowSign) return <View key={k} style={styles.key} />;
            return (
              <Pressable key={k} onPress={() => press(k)} onLongPress={k === "⌫" ? () => onChange("") : undefined}
                style={({ pressed }) => [styles.key, wide && styles.wide, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={k === "⌫" ? t("Delete") : k === "C" ? t("Clear") : k === "±" ? t("Change sign") : k}>
                {k === "⌫" ? <SymbolView name="delete.left" size={22} tintColor={C.label} />
                  : k === "±" ? <SymbolView name="plus.forwardslash.minus" size={20} tintColor={C.label} />
                  : <Text style={[styles.keyText, k === "C" && styles.clear, fn && styles.fnText]} maxFontSizeMultiplier={1.3}>{k}</Text>}
              </Pressable>
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
  key: { flex: 1, minHeight: 50, borderRadius: R.md, alignItems: "center", justifyContent: "center", backgroundColor: C.fill },
  wide: { flex: 1 },
  pressed: { opacity: 0.55 },
  keyText: { fontSize: 27, fontWeight: "500", color: C.label, fontVariant: ["tabular-nums"] },
  fnText: { fontSize: 22 },
  clear: { color: C.orange, fontWeight: "600" },
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
