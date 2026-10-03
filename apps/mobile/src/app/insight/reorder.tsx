import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { getRow, listRows, parseInsightParams, save, type Insight } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { ReorderList } from "@/components/ReorderList";
import { INSIGHT_LOOK, kindHint, kindTitle } from "@/lib/insights";
import { t } from "@/i18n";

/** Drag the insight cards into the order you want them on the Insights tab. */
export default function InsightReorder() {
  const insights = useQuery((d) => listRows(d, "insights", "deleted=0", [], "sort, rowid") as Insight[]);
  const items = useMemo(() => insights.map((i) => {
    const kind = kindTitle(i.kind);
    const title = parseInsightParams(i.params).title || kind;
    const look = INSIGHT_LOOK[i.kind];
    return {
      id: i.id, title,
      subtitle: title !== kind ? kind : kindHint(i.kind),
      icon: look ? <View style={[styles.icon, { backgroundColor: look.color }]}><SymbolView name={look.icon} size={16} tintColor="white" /></View> : undefined,
    };
  }), [insights]);
  const commit = (ids: string[]) => mutate((d) => ids.forEach((id, n) => { const i = getRow(d, "insights", id); if (i && i.sort !== n) save(d, "insights", { ...i, sort: n } as Insight); }));
  return <ReorderList title={t("insights.reorder.title")} items={items} onDone={commit}
    hint={t("insights.reorder.hint")}
    empty={{ title: t("insights.reorder.emptyTitle"), hint: t("insights.reorder.emptyHint") }} />;
}

const styles = StyleSheet.create({
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
