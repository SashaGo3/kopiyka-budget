import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { C, S } from "@/constants/theme";
import { monthBounds, shiftMonth } from "@/lib/dates";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** YYYY-MM-DD of a day in a month, however far out of range `d` is (JS dates carry it over). */
function day(y: number, m: number, d: number): string {
  const x = new Date(y, m - 1, d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/**
 * A month grid that picks a range of days: the first tap is the first day, the second the last. A
 * tap before the first day starts again from there, so a wrong first tap is undone by the next one
 * rather than by a button.
 *
 * Drawn in React Native rather than with the system date picker, because the system one picks a
 * single day and the whole point here is the span between two — and because this one can take the
 * full width of the sheet, which gives every day a target the size of a keypad key.
 *
 * `maxStart` is the latest day the range may begin on; a later day can still end it.
 */
export function RangeCalendar({ start, end, onChange, maxStart }: {
  start: string; end: string | null; onChange: (start: string, end: string | null) => void; maxStart?: string;
}) {
  const [month, setMonth] = useState(() => monthBounds(end ?? start).start);
  const [y, m] = month.split("-").map(Number) as [number, number];
  // Monday first: the week a trip is planned in, weekends together at the end.
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => day(y, m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const tap = (d: string) => {
    void Haptics.selectionAsync();
    if (end === null && d >= start) { onChange(start, d); return; }
    if (maxStart && d > maxStart) { onChange(start, d < start ? start : d); return; }
    onChange(d, null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10} style={styles.nav} accessibilityRole="button" accessibilityLabel="Previous month">
          <SymbolView name="chevron.left" size={16} tintColor={C.tint} />
        </Pressable>
        <Text style={styles.month}>{monthBounds(month).label}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={10} style={styles.nav} accessibilityRole="button" accessibilityLabel="Next month">
          <SymbolView name="chevron.right" size={16} tintColor={C.tint} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((w, i) => <Text key={i} style={styles.weekday}>{w}</Text>)}
      </View>
      {weeks.map((w, i) => (
        <View key={i} style={styles.week}>
          {w.map((d, j) => {
            if (!d) return <View key={j} style={styles.cell} />;
            const last = end ?? start;
            const inside = d > start && d < last;
            const edge = d === start || d === last;
            // The band runs behind the whole span, cut in half at either end so the circles sit on it.
            const bandLeft = inside || (d === last && end !== null && end !== start);
            const bandRight = inside || (d === start && end !== null && end !== start);
            return (
              <Pressable key={j} onPress={() => tap(d)} style={styles.cell} accessibilityRole="button"
                accessibilityLabel={d} accessibilityState={{ selected: edge || inside }}>
                {bandLeft ? <View style={[styles.band, { left: 0, right: "50%" }]} /> : null}
                {bandRight ? <View style={[styles.band, { left: "50%", right: 0 }]} /> : null}
                <View style={[styles.dot, edge && styles.dotOn]}>
                  <Text style={[styles.dayText, inside && styles.dayInside, edge && styles.dayOn]}>{Number(d.slice(8, 10))}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: S.md, backgroundColor: C.card, borderRadius: 16, paddingHorizontal: S.sm, paddingVertical: S.md, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.sm, paddingBottom: S.sm },
  nav: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: C.fill },
  month: { fontSize: 17, fontWeight: "600", color: C.label },
  week: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600", color: C.tertiary, paddingBottom: 4 },
  cell: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  band: { position: "absolute", top: 4, bottom: 4, backgroundColor: C.tint, opacity: 0.18 },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dotOn: { backgroundColor: C.tint },
  dayText: { fontSize: 17, color: C.label, fontVariant: ["tabular-nums"] },
  dayInside: { color: C.tint, fontWeight: "600" },
  dayOn: { color: C.onTint, fontWeight: "700" },
});
