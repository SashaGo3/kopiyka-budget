import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { INSIGHT_KINDS, getRow, listRows, parseInsightParams, save, type Insight } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { ReorderList } from "@/components/ReorderList";
import { INSIGHT_LOOK } from "@/lib/insights";

/** Drag the insight cards into the order you want them on the Insights tab. */
export default function InsightReorder() {
  const insights = useQuery((d) => listRows(d, "insights", "deleted=0", [], "sort, rowid") as Insight[]);
  const items = useMemo(() => insights.map((i) => {
    const meta = INSIGHT_KINDS.find((k) => k.kind === i.kind);
    const title = parseInsightParams(i.params).title || meta?.title || i.kind;
    const look = INSIGHT_LOOK[i.kind];
    return {
      id: i.id, title,
      subtitle: title !== meta?.title ? meta?.title : meta?.hint,
      icon: look ? <View style={[styles.icon, { backgroundColor: look.color }]}><SymbolView name={look.icon} size={16} tintColor="white" /></View> : undefined,
    };
  }), [insights]);
  const commit = (ids: string[]) => mutate((d) => ids.forEach((id, n) => { const i = getRow(d, "insights", id); if (i && i.sort !== n) save(d, "insights", { ...i, sort: n } as Insight); }));
  return <ReorderList title="Reorder insights" items={items} onDone={commit}
    hint="Drag by the grip on the right. The order here is the order on Insights."
    empty={{ title: "No insights", hint: "Add one on the Insights tab first." }} />;
}

const styles = StyleSheet.create({
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
