import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";
import * as Haptics from "expo-haptics";
import { formatMinor, type Series, type SeriesPoint } from "@kopiyka/core";
import { Card, Money, Row } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { dayMonth, monthShort, periodLabel } from "@/lib/dates";
import { t } from "@/i18n";

const HEIGHT = 96;

/** "Mar" for a month that starts on the 1st, "15 Mar" for a week or a period that starts on payday. */
function pointLabel(p: SeriesPoint, weekly: boolean): string {
  const [, m, d] = p.start.split("-").map(Number) as [number, number, number];
  return weekly || d !== 1 ? dayMonth(d, m) : monthShort(m);
}

/**
 * A period-by-period history as bars, the dashed line at the average, and the numbers that sum it up
 * underneath. Only the first and last bars are labelled — a label on every bar is noise nobody reads,
 * and the question is the shape — but tapping a bar names it and its amount in the line above, so any
 * one period can still be read off exactly.
 *
 * `color` is the bars' (the card's own hue); the running period is drawn paler, because it is not
 * over yet and a short bar there is not news. `kind` only words the summary: what was spent, what came in, or a balance.
 * `limit` draws a budget's line across the bars, solid where the average is dashed, and a bar that went
 * over it is drawn orange: a budget's history is mostly the question of which months stayed under.
 * Income adds what a year at the average comes to, and says nothing about a running period of nothing yet.
 */
export function HistoryChart({ series, color, weekly, kind = "spend", limit }: { series: Series; color: ColorValue; weekly?: boolean; kind?: "spend" | "income" | "balance"; limit?: number }) {
  const pts = series.points;
  const [picked, setPicked] = useState<number | null>(null);
  const top = Math.max(1, ...pts.map((p) => p.minor), limit ?? 0);
  const limitY = limit && limit > 0 ? Math.round((limit / top) * HEIGHT) : null;
  const pick = picked !== null && picked < pts.length ? pts[picked]! : null;
  const avgY = series.periods ? Math.round((series.average_minor / top) * HEIGHT) : null;
  const fmt = (minor: number) => `${formatMinor(minor, series.currency)} ${series.currency}`;
  const line = (label: string, minor: number, key: string, first = false) => (
    <Row key={key} title={label} right={<Money minor={minor} currency={series.currency} style={styles.amount} />} style={first ? undefined : styles.divider} />
  );
  const unit = weekly ? "week" : "month";
  return (
    <Card>
      <View style={styles.chartBox}>
        <Text style={styles.pickLine} numberOfLines={1}>
          {pick ? `${periodLabel(pick.start, pick.end)} · ${fmt(pick.minor)}${pick.current ? ` · ${t("insights.history.soFar")}` : ""}` : " "}
        </Text>
        <View style={styles.bars} accessible accessibilityLabel={t("insights.history.chartA11y", { count: pts.length, average: fmt(series.average_minor) })}>
          {avgY !== null && avgY > 0 ? <View pointerEvents="none" style={[styles.avg, { bottom: avgY }]} /> : null}
          {limitY !== null ? <View pointerEvents="none" style={[styles.limit, { bottom: limitY }]} /> : null}
          {pts.map((p, i) => {
            const h = p.minor > 0 ? Math.max(3, Math.round((p.minor / top) * HEIGHT)) : 2;
            const on = picked === i;
            return (
              <Pressable key={p.start} style={styles.slot} hitSlop={{ top: 8, bottom: 8 }} onPress={() => { void Haptics.selectionAsync(); setPicked(on ? null : i); }}>
                <View style={[styles.bar, { height: h, backgroundColor: p.minor > 0 ? (limit && p.minor > limit ? C.orange : color) : C.fill, opacity: on || picked === null ? (p.current ? 0.45 : 1) : 0.35 }]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.axis}>
          <Text style={styles.axisText}>{pts[0] ? pointLabel(pts[0], !!weekly) : ""}</Text>
          <Text style={styles.axisText}>{pts.length > 1 ? pointLabel(pts[pts.length - 1]!, !!weekly) : ""}</Text>
        </View>
      </View>
      {series.periods ? line(t(`insights.history.avg.${unit}`, { count: series.periods }), series.average_minor, "avg", true) : null}
      {series.current_minor !== null && !(kind === "income" && !series.current_minor) ? line(t("insights.history.current"), series.current_minor, "now") : null}
      {series.periods ? line(t(`insights.history.last.${unit}`), series.last_minor, "last") : null}
      {series.periods > 1 ? line(t(`insights.history.highest.${kind}`), series.max_minor, "max") : null}
      {series.periods > 1 && series.min_minor !== series.max_minor && series.min_minor > 0 ? line(t(`insights.history.lowest.${kind}`), series.min_minor, "min") : null}
      {kind === "income" && !weekly && series.periods ? line(t("insights.history.perYear"), series.average_minor * 12, "year") : null}
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  chartBox: { paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.sm, gap: 6 },
  pickLine: { fontSize: 13, color: C.secondary, fontVariant: ["tabular-nums"] },
  bars: { height: HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  slot: { flex: 1, height: HEIGHT, justifyContent: "flex-end" },
  bar: { borderRadius: 3 },
  limit: { position: "absolute", left: 0, right: 0, height: 0, borderTopWidth: 1.5, borderColor: C.label, opacity: 0.5 },
  avg: { position: "absolute", left: 0, right: 0, height: 0, borderTopWidth: 1, borderStyle: "dashed", borderColor: C.secondary },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 11, color: C.secondary },
  amount: { fontSize: 16, fontWeight: "600", color: C.label },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
