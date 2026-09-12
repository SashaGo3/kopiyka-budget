import { useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { Row, accountIcon } from "@/components/ui";
import { C, S } from "@/constants/theme";

/**
 * Multi-select accounts (filters), one section per group. The section header has its own
 * check that selects or clears the whole group; with a single group (or none) there is just
 * one "All accounts" section. Resolves an array of ids; empty = any account.
 */
export default function PickAccounts() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const [chosen, setChosen] = useState<string[]>(() => (selected ? selected.split(",").filter(Boolean) : []));
  const sections = useQuery((db) => {
    const accounts = listRows(db, "accounts", "deleted=0", [], "archived, sort, name");
    const groups = [...new Set(accounts.map((a) => a.group_name))];
    if (groups.length <= 1) return [{ title: "All accounts", data: accounts }];
    return groups.map((g) => ({ title: g || "Other", data: accounts.filter((a) => a.group_name === g) }));
  });
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const toggleGroup = (ids: string[]) => setChosen((c) => (ids.every((id) => c.includes(id)) ? c.filter((x) => !ids.includes(x)) : [...c, ...ids.filter((id) => !c.includes(id))]));
  const done = () => { resolvePick(key, chosen); router.back(); };
  return (
    <SectionList style={{ flex: 1, backgroundColor: C.bgGrouped }} sections={sections} keyExtractor={(a) => a.id} contentContainerStyle={{ paddingBottom: 60 }} stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.head}>
          <View style={styles.side}><Pressable onPress={() => setChosen([])} hitSlop={10} accessibilityRole="button" accessibilityLabel="Any account"><Text style={[styles.link, !chosen.length && { fontWeight: "700" }]}>Any</Text></Pressable></View>
          <Text style={styles.title}>Accounts</Text>
          <View style={[styles.side, { alignItems: "flex-end" }]}><Pressable onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done" style={styles.doneBtn}><Text style={styles.done}>Done{chosen.length ? ` (${chosen.length})` : ""}</Text></Pressable></View>
        </View>
      }
      renderSectionHeader={({ section }) => {
        const ids = section.data.map((a) => a.id);
        const all = ids.length > 0 && ids.every((id) => chosen.includes(id));
        const some = !all && ids.some((id) => chosen.includes(id));
        return (
          <Pressable onPress={() => toggleGroup(ids)} style={styles.group} accessibilityRole="checkbox" accessibilityState={{ checked: all ? true : some ? "mixed" : false }} accessibilityLabel={`${section.title}, ${ids.length} account${ids.length === 1 ? "" : "s"}`}>
            <Text style={styles.groupTitle}>{section.title}</Text>
            <SymbolView name={all ? "checkmark.circle.fill" : some ? "minus.circle" : "circle"} size={22} tintColor={all || some ? C.tint : C.tertiary} />
          </Pressable>
        );
      }}
      renderItem={({ item: a }) => (
        <Row title={a.name} subtitle={[a.currency, a.archived ? "archived" : null].filter(Boolean).join(" · ")} icon={accountIcon(a.type)} iconColor={a.color ?? undefined} style={styles.account}
          onPress={() => toggle(a.id)} right={<SymbolView name={chosen.includes(a.id) ? "checkmark.circle.fill" : "circle"} size={22} tintColor={chosen.includes(a.id) ? C.tint : C.tertiary} />} />
      )} />
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.sm, backgroundColor: C.bgGrouped },
  side: { width: 90 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600", color: C.label },
  link: { color: C.tint, fontSize: 15 },
  doneBtn: { backgroundColor: C.tint, paddingHorizontal: 14, minHeight: 34, paddingVertical: 4, borderRadius: 17, justifyContent: "center" },
  done: { color: C.onTint, fontSize: 15, fontWeight: "700" },
  group: { flexDirection: "row", alignItems: "center", paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.xs, minHeight: 44 },
  groupTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: C.label },
  account: { backgroundColor: "transparent", paddingLeft: S.lg + S.md },
});
