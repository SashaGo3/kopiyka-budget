import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listRows, type Insight } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Empty, FadeIn } from "@/components/ui";
import { InsightCard } from "@/components/InsightCard";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/** User-added statistics cards. Each card is computed in core from its stored params. */
export default function InsightsScreen() {
  const insights = useQuery((db) => listRows(db, "insights", "deleted=0", [], "sort, rowid") as Insight[]);
  const canReorder = insights.length > 1;
  const reorder = () => router.push("/insight/reorder");
  return (
    <>
      {/* A screen for reading: the two things that change it sit in the header, out of the cards' way. */}
      <Stack.Screen options={{ title: t("insights.screenTitle"), headerLargeTitle: true, headerRight: () => (
        <View style={styles.headerButtons}>
          {canReorder ? (
            <Pressable onPress={reorder} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }} accessibilityRole="button" accessibilityLabel={t("insights.reorder.title")}>
              <SymbolView name="arrow.up.arrow.down" size={19} tintColor={C.tint} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push({ pathname: "/insight/edit", params: { id: "new" } })} hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }} accessibilityRole="button" accessibilityLabel={t("insights.add")}>
            <SymbolView name="plus" size={20} tintColor={C.tint} />
          </Pressable>
        </View>
      ) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120, paddingTop: S.sm, gap: S.md }}>
        {insights.length === 0 ? <Empty title={t("insights.empty")} hint={t("insights.emptyHint")} /> : null}
        {insights.map((i, n) => <FadeIn key={i.id} delay={n * 60}><InsightCard insight={i} reorder={canReorder ? reorder : undefined} /></FadeIn>)}
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  // Far enough apart that a thumb aiming for one never lands on the other.
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 36, paddingHorizontal: 6 },
}));
