import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { listRows, type Insight } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Empty, FadeIn } from "@/components/ui";
import { InsightCard } from "@/components/InsightCard";
import { PeriodPill } from "@/components/PeriodPill";
import { S, themed } from "@/constants/theme";
import { currentPeriod, getPeriodStartDay, periodContaining, usePeriod } from "@/lib/period";
import { shownInsights } from "@/lib/insights";
import { t } from "@/i18n";

/**
 * User-added statistics cards. Each card is computed in core from its stored params, for the month
 * Budgets and Transactions are showing — the pill at the top says which, and a tap on it picks
 * another. A card opens to its details (`[id].tsx`), where it is also edited.
 */
export default function InsightsScreen() {
  const insights = shownInsights(useQuery((db) => listRows(db, "insights", "deleted=0", [], "sort, rowid") as Insight[]));
  const canReorder = insights.length > 1;
  const reorder = () => router.push("/insight/reorder");
  const [period, setPeriod] = usePeriod();
  const monthKey = useMemo(() => newPickKey("imonth"), []);
  usePickResult<string>(monthKey, useCallback((d: string) => setPeriod(periodContaining(`${d.slice(0, 8)}${String(Math.min(getPeriodStartDay(), 28)).padStart(2, "0")}`)), [setPeriod]));
  return (
    <>
      {/* Reorder and Add both on the right, as native bar items, each on a glass capsule of its own
          (`sharesBackground: false` and a gap between): drawn as one capsule, a thumb aiming for one
          landed on the other. */}
      <Stack.Screen options={{ title: t("insights.screenTitle"), headerLargeTitle: true,
        unstable_headerRightItems: () => [
          ...(canReorder ? [
            { type: "button" as const, label: t("insights.reorder.title"), icon: { type: "sfSymbol" as const, name: "line.3.horizontal" as const }, onPress: reorder, sharesBackground: false, accessibilityLabel: t("insights.reorder.title") },
            { type: "spacing" as const, spacing: 8 },
          ] : []),
          { type: "button" as const, label: t("insights.add"), icon: { type: "sfSymbol" as const, name: "plus" as const }, onPress: () => router.push({ pathname: "/insight/edit", params: { id: "new" } }), sharesBackground: false, accessibilityLabel: t("insights.add") },
        ] }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120, paddingTop: S.sm, gap: S.md }}>
        {/* Just the month, no arrows: stepping through months is what Budgets is for; here it is a
            question asked now and then, so the picker opens only when the pill is tapped. */}
        {insights.length ? (
          <View style={styles.pills}>
            <PeriodPill period={period} onReset={() => setPeriod(currentPeriod())}
              onPick={() => router.push({ pathname: "/pick/month", params: { key: monthKey, selected: period.start, now: currentPeriod().start } })} />
          </View>
        ) : null}
        {insights.length === 0 ? <Empty title={t("insights.empty")} hint={t("insights.emptyHint")} /> : null}
        {insights.map((i, n) => <FadeIn key={i.id} delay={n * 60}><InsightCard insight={i} /></FadeIn>)}
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  pills: { flexDirection: "row", paddingHorizontal: S.lg },
}));
