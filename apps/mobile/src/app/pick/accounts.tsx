import { useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { HeaderBar, Row, accountIcon } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";
import { acctName, groupName } from "@/lib/names";

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
    if (groups.length <= 1) return [{ title: t("pick.accounts.all"), data: accounts }];
    return groups.map((g) => ({ title: groupName(g) || t("pick.accounts.other"), data: accounts.filter((a) => a.group_name === g) }));
  });
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const toggleGroup = (ids: string[]) => setChosen((c) => (ids.every((id) => c.includes(id)) ? c.filter((x) => !ids.includes(x)) : [...c, ...ids.filter((id) => !c.includes(id))]));
  const done = () => { resolvePick(key, chosen); router.back(); };
  return (
    <SectionList style={{ flex: 1, backgroundColor: C.bgGrouped }} sections={sections} keyExtractor={(a) => a.id} contentContainerStyle={{ paddingBottom: 60 }} stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <HeaderBar style={styles.head} title={t("pick.accounts.title")}
          left={<Pressable onPress={() => setChosen([])} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("pick.accounts.anyA11y")}><Text style={[styles.link, !chosen.length && { fontWeight: "700" }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{t("pick.any")}</Text></Pressable>}
          right={<Pressable onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.done")} style={styles.doneBtn}><Text style={styles.done} numberOfLines={1} maxFontSizeMultiplier={1.3}>{chosen.length ? t("pick.doneCount", { count: chosen.length }) : t("common.done")}</Text></Pressable>} />
      }
      renderSectionHeader={({ section }) => {
        const ids = section.data.map((a) => a.id);
        const all = ids.length > 0 && ids.every((id) => chosen.includes(id));
        const some = !all && ids.some((id) => chosen.includes(id));
        return (
          <Pressable onPress={() => toggleGroup(ids)} style={styles.group} accessibilityRole="checkbox" accessibilityState={{ checked: all ? true : some ? "mixed" : false }} accessibilityLabel={t("pick.accounts.groupA11y", { group: section.title, count: ids.length })}>
            <Text style={styles.groupTitle}>{section.title}</Text>
            <SymbolView name={all ? "checkmark.circle.fill" : some ? "minus.circle" : "circle"} size={22} tintColor={all || some ? C.tint : C.tertiary} />
          </Pressable>
        );
      }}
      renderItem={({ item: a }) => (
        <Row title={acctName(a)} subtitle={[a.currency, a.archived ? t("pick.accounts.archived") : null].filter(Boolean).join(" · ")} icon={accountIcon(a.type)} iconFill={a.color} style={styles.account}
          onPress={() => toggle(a.id)} right={<SymbolView name={chosen.includes(a.id) ? "checkmark.circle.fill" : "circle"} size={22} tintColor={chosen.includes(a.id) ? C.tint : C.tertiary} />} />
      )} />
  );
}

const styles = themed(() => StyleSheet.create({
  head: { paddingTop: S.md, paddingBottom: S.sm, backgroundColor: C.bgGrouped },
  link: { color: C.tint, fontSize: 15 },
  doneBtn: { backgroundColor: C.tint, paddingHorizontal: 14, minHeight: 34, paddingVertical: 4, borderRadius: 17, justifyContent: "center" },
  done: { color: C.onTint, fontSize: 15, fontWeight: "700" },
  group: { flexDirection: "row", alignItems: "center", paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.xs, minHeight: 44 },
  groupTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: C.label },
  account: { backgroundColor: "transparent", paddingLeft: S.lg + S.md },
}));
