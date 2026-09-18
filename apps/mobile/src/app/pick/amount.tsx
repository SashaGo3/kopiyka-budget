import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { formatMinor, toMinor } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { C, S } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Amount entry with the app keypad. Resolves minor units (number).
 *
 * `max` (minor units) is a ceiling the answer cannot go over — a part of a split cannot be worth
 * more than the entry has left to give it. Going over is shown and refused here rather than
 * silently clamped, so the number the caller gets back is always the number that was typed.
 */
export default function PickAmount() {
  const { key, title, currency, value, max } = useLocalSearchParams<{ key: string; title?: string; currency?: string; value?: string; max?: string }>();
  const cur = currency ?? "EUR";
  const [expr, setExpr] = useState(value && Number(value) ? String(Number(value) / 100) : "");
  const insets = useSafeAreaInsets();
  const v = evalExpr(expr);
  const abs = v !== null ? Math.abs(v) : null;
  const ceiling = max ? Math.abs(Number(max)) : null;
  const minor = abs !== null ? toMinor(abs, cur) : null;
  const tooMuch = ceiling !== null && minor !== null && minor > ceiling;
  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.xl, paddingBottom: Math.max(insets.bottom, S.md), gap: S.md }}>
      <Text style={styles.title}>{title ?? "Amount"}</Text>
      <Text style={[styles.amount, tooMuch && { color: C.red }]}>{abs !== null ? formatMinor(toMinor(abs, cur), cur) : expr || "0"} <Text style={styles.cur}>{cur}</Text></Text>
      {ceiling !== null ? <Text style={[styles.limit, tooMuch && { color: C.red }]}>{tooMuch ? `More than the ${formatMinor(ceiling, cur)} ${cur} there is to give` : `${formatMinor(ceiling, cur)} ${cur} available`}</Text> : null}
      <Keypad value={expr} onChange={setExpr} allowSign={false} />
      <ConfirmBar amount={`${abs !== null ? formatMinor(toMinor(abs, cur), cur) : "0"} ${cur}`} label="Use this amount" disabled={abs === null || abs === 0 || tooMuch} onPress={() => { resolvePick(key, toMinor(abs!, cur)); router.back(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { textAlign: "center", fontSize: 15, color: C.secondary },
  amount: { textAlign: "center", fontSize: 40, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  cur: { fontSize: 18, color: C.secondary },
  limit: { textAlign: "center", fontSize: 13, color: C.secondary, marginTop: -S.sm },
});
