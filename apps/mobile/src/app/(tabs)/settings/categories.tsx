import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { archivedCategoryIds, categoryImportance, listRows, markableCategories, markableLeaves, unmarkedCount } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, CategoryIcon, Empty, Row, ScreenNote, SectionHeader } from "@/components/ui";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { C, S, themed } from "@/constants/theme";
import { catName } from "@/lib/names";
import { t } from "@/i18n";

/** Folders and their categories; tap any row to edit it. Add lives in the thumb zone. */
export default function CategoriesScreen() {
  // The Add bar slides away while scrolling down, as on Transactions, and comes back on the way up.
  const { visible, onScroll } = useScrollHide();
  const groups = useQuery((db) => {
    const every = listRows(db, "categories", "deleted=0", [], "sort, name");
    // Retired ones stand apart at the foot of the screen — with their folder, when the whole folder
    // was retired — so the working list is only what can actually be chosen.
    const retired = archivedCategoryIds(every);
    const all = every.filter((c) => !retired.has(c.id));
    const parents = all.filter((c) => !c.parent_id);
    const orphans = all.filter((c) => c.parent_id && !parents.some((p) => p.id === c.parent_id));
    return {
      list: parents.map((p) => ({ parent: p, children: all.filter((c) => c.parent_id === p.id) })),
      orphans,
      archived: every.filter((c) => retired.has(c.id)).map((c) => ({ c, byFolder: !c.archived })),
    };
  });
  // How far the "what matters" marking has got. The unmarked count is the load-bearing half:
  // categories added later start unset, and nothing else will ever say that the figures built on
  // importance have gone stale.
  const matters = useQuery((db) => {
    const asked = markableCategories(db);
    const level = categoryImportance(asked);
    const leaves = markableLeaves(asked);
    return { total: leaves.length, unmarked: unmarkedCount(asked), marked: leaves.filter((c) => level.get(c.id)).length };
  });
  const add = () => Alert.alert(t("settingsLists.categories.add"), undefined, [
    { text: t("settingsLists.categories.newCategory"), onPress: () => router.push({ pathname: "/category/edit", params: { id: "new", parent: groups.list[0]?.parent.id ?? "" } }) },
    { text: t("settingsLists.categories.newFolder"), onPress: () => router.push({ pathname: "/category/edit", params: { id: "new", folder: "1" } }) },
    { text: t("common.cancel"), style: "cancel" },
  ]);
  return (
    <>
      <Stack.Screen options={{ title: t("settingsLists.categories.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={t("settingsLists.categories.introMore")}>{t("settingsLists.categories.introShort")}</ScreenNote>
        {matters.total ? (
          <Card>
            <Row title={t("settingsLists.categories.matters")} icon="heart.text.square"
              subtitle={matters.marked === 0 ? t("settingsLists.categories.mattersNone")
                : matters.unmarked ? t("settingsLists.categories.mattersPartial", { marked: matters.marked, unmarked: matters.unmarked })
                : t("settingsLists.categories.mattersAll", { count: matters.marked })}
              subtitleColor={matters.unmarked && matters.marked ? C.orange : undefined}
              onPress={() => router.push("/category/importance")} />
          </Card>
        ) : null}
        {groups.list.length === 0 ? <Empty title={t("settingsLists.categories.emptyTitle")} hint={t("settingsLists.categories.emptyHint")} /> : null}
        {groups.list.map(({ parent, children }) => (
          <Card key={parent.id} style={{ marginTop: S.lg }}>
            <Row title={catName(parent)} subtitle={parent.kind === "income" ? t("settingsLists.categories.folderIncome", { count: children.length }) : t("settingsLists.categories.folder", { count: children.length })}
              onPress={() => router.push({ pathname: "/category/edit", params: { id: parent.id } })}
              right={<View style={styles.right}><CategoryIcon name={catName(parent)} icon={parent.icon} color={parent.color} size={30} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
            {children.map((c) => <Row key={c.id} title={catName(c)} onPress={() => router.push({ pathname: "/category/edit", params: { id: c.id } })} style={[styles.divider, styles.child]}
              right={<View style={styles.right}><CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={26} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />)}
            <Row title={t("settingsLists.categories.addHere")} onPress={() => router.push({ pathname: "/category/edit", params: { id: "new", parent: parent.id } })} style={[styles.divider, styles.child, { opacity: 0.7 }]} />
          </Card>
        ))}
        {groups.orphans.length ? (
          <Card style={{ marginTop: S.lg }}>
            {groups.orphans.map((c, i) => <Row key={c.id} title={catName(c)} subtitle={t("settingsLists.categories.noFolder")} onPress={() => router.push({ pathname: "/category/edit", params: { id: c.id } })} style={i > 0 ? styles.divider : undefined} />)}
          </Card>
        ) : null}
        {groups.archived.length ? <SectionHeader>{t("settingsLists.categories.archived")}</SectionHeader> : null}
        {groups.archived.length ? (
          <Card>
            {groups.archived.map(({ c, byFolder }, i) => (
              <Row key={c.id} title={catName(c)} subtitle={byFolder ? t("settingsLists.categories.inArchivedFolder") : t("settingsLists.categories.archived")} onPress={() => router.push({ pathname: "/category/edit", params: { id: c.id } })} style={[i > 0 ? styles.divider : undefined, { opacity: 0.6 }]}
                right={<View style={styles.right}><CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={26} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
            ))}
          </Card>
        ) : null}
        {groups.archived.length ? <ScreenNote>{t("settingsLists.categories.archivedNote")}</ScreenNote> : null}
      </ScrollView>
      <BottomBar visible={visible}><BarButton icon="plus" label={t("settingsLists.categories.add")} onPress={add} a11y={t("settingsLists.categories.add")} /></BottomBar>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  child: { paddingLeft: S.xl + 8 },
  right: { flexDirection: "row", alignItems: "center", gap: 8 },
}));
