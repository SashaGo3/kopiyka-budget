import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { resolvePick } from "@/store/pick";
import { C, S } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Year row with arrows and a 4×3 grid of months; tapping a month picks it. Resolves "YYYY-MM-01".
 * "This month" under the grid is the way back for anyone who has browsed off into another year and
 * lost track of where now is — the current month is highlighted in the grid too, but only while its
 * own year is on screen. `now` is the caller's idea of the month it is in (Budgets and Transactions
 * pass the current *period*, which with a mid-month start day is named after the month before);
 * without it, today's calendar month.
 */
export default function PickMonth() {
  const { key, selected, now } = useLocalSearchParams<{ key: string; selected?: string; now?: string }>();
  const sel = selected ?? new Date().toISOString().slice(0, 10);
  const [year, setYear] = useState(Number(sel.slice(0, 4)));
  const insets = useSafeAreaInsets();
  const cur = new Date();
  const nowMonth = (now || `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-01`).slice(0, 7);
  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.md, paddingBottom: Math.max(insets.bottom, S.md), gap: S.md }}>
      <View style={styles.yearRow}>
        <Pressable onPress={() => setYear((y) => y - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous year" style={styles.arrow}><SymbolView name="chevron.left" size={18} tintColor={C.tint} /></Pressable>
        <Text style={styles.year}>{year}</Text>
        <Pressable onPress={() => setYear((y) => y + 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next year" style={styles.arrow}><SymbolView name="chevron.right" size={18} tintColor={C.tint} /></Pressable>
      </View>
      <View style={styles.grid}>
        {MONTHS.map((m, i) => {
          const v = `${year}-${String(i + 1).padStart(2, "0")}-01`;
          const on = v.slice(0, 7) === sel.slice(0, 7);
          const isNow = v.slice(0, 7) === nowMonth;
          return (
            <Pressable key={m} onPress={() => { resolvePick(key, v); router.back(); }} accessibilityRole="button" accessibilityLabel={`${m} ${year}`} accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.cell, on && styles.cellOn, pressed && { opacity: 0.6 }]}>
              <Text style={[styles.cellText, on && { color: C.onTint }, isNow && !on && { color: C.tint, fontWeight: "700" }]}>{m}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={() => { resolvePick(key, `${nowMonth}-01`); router.back(); }} accessibilityRole="button" accessibilityLabel="This month"
        style={({ pressed }) => [styles.now, pressed && { opacity: 0.6 }]}>
        <SymbolView name="calendar" size={16} tintColor={C.tint} />
        <Text style={styles.nowText}>This month</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.xl },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: C.fill },
  year: { fontSize: 22, fontWeight: "700", color: C.label, minWidth: 80, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: S.sm, paddingHorizontal: S.md },
  cell: { width: "23%", flexGrow: 1, minHeight: 52, paddingVertical: 8, borderRadius: 14, backgroundColor: C.card, alignItems: "center", justifyContent: "center" },
  cellOn: { backgroundColor: C.tint },
  cellText: { fontSize: 17, fontWeight: "600", color: C.label },
  now: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: S.md, minHeight: 44, borderRadius: 14, backgroundColor: C.fill },
  nowText: { fontSize: 16, fontWeight: "600", color: C.tint },
});
