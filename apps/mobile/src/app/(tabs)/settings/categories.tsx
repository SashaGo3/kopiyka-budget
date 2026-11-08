import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { archivedCategoryIds, getCategoryOrder, type CategoryOrder, categoryImportance, categoryTypes, folderIds, listRows, markableCategories, markableLeaves, missingPresets, unmarkedCount } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, CategoryIcon, Empty, Row, ScreenNote, SectionHeader, Segmented } from "@/components/ui";
import { setCategoryOrderSetting } from "@/lib/settings";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { C, S, themed } from "@/constants/theme";
import { catName, orderedCategories } from "@/lib/names";
import { t } from "@/i18n";

/** Folders and their categories; tap any row to edit it. Add lives in the thumb zone. */
export default function CategoriesScreen() {
  // The Add bar slides away while scrolling down, as on Transactions, and comes back on the way up.
  const { visible, onScroll } = useScrollHide();
  const groups = useQuery((db) => {
    const every = orderedCategories(db, listRows(db, "categories", "deleted=0", [], "sort, name"));
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
  // Categories nothing says the kind of (DATA.md rule 21): a well-known shop cannot be filed into them.
  // Ready-made categories this phone has nothing for — new in a later version, or skipped at onboarding.
  const missing = useQuery((db) => missingPresets(db).length);
  const untyped = useQuery((db) => {
    const all = listRows(db, "categories", "deleted=0");
    const folders = folderIds(all), gone = archivedCategoryIds(all);
    return all.filter((c) => !folders.has(c.id) && !gone.has(c.id) && !categoryTypes(c).length && c.type !== "none" && c.type !== "[]").length;
  });
  // The order every list of categories follows (core categoryOrder.ts); read through a query so the
  // list below re-sorts the moment it changes.
  const order = useQuery((db) => getCategoryOrder(db));
  // Only a sitting already started counts as unfinished: never having marked anything is a choice.
  const mattersDue = matters.marked && matters.unmarked ? matters.unmarked : 0;
  const toSort = mattersDue + untyped;
  const mattersRow = (divider: boolean) => (
    <Row title={t("settingsLists.categories.matters")} icon="heart.text.square" style={divider ? styles.divider : undefined}
      subtitle={matters.marked === 0 ? t("settingsLists.categories.mattersNone")
        : matters.unmarked ? t("settingsLists.categories.mattersPartial", { marked: matters.marked, unmarked: matters.unmarked })
        : t("settingsLists.categories.mattersAll", { count: matters.marked })}
      subtitleColor={mattersDue ? C.orange : undefined}
      onPress={() => router.push("/category/importance")} />
  );
  const typesRow = (divider: boolean) => (
    <Row title={t("settingsLists.categories.types")} icon="storefront" style={divider ? styles.divider : undefined}
      subtitle={untyped ? t("settingsLists.categories.typesMissing", { count: untyped }) : t("settingsLists.categories.typesAll")}
      subtitleColor={untyped ? C.orange : undefined}
      onPress={() => router.push("/category/types")} />
  );
  const add = () => Alert.alert(t("settingsLists.categories.add"), undefined, [
    { text: t("settingsLists.categories.newCategory"), onPress: () => router.push({ pathname: "/category/edit", params: { id: "new" } }) },
    { text: t("settingsLists.categories.newFolder"), onPress: () => router.push({ pathname: "/category/edit", params: { id: "new", folder: "1" } }) },
    { text: t("common.cancel"), style: "cancel" },
  ]);
  return (
    <>
      <Stack.Screen options={{ title: t("settingsLists.categories.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={t("settingsLists.categories.introMore")}>{t("settingsLists.categories.introShort")}</ScreenNote>
        {/* What needs something from you, in one place at the top: categories added since the What
            matters sitting, and categories no shop can be filed into. Everything settled — and the
            optional extras — sits quietly below. */}
        {toSort ? <SectionHeader>{t("settingsLists.categories.toSort", { count: toSort })}</SectionHeader> : null}
        {toSort ? (
          <Card>
            {mattersDue ? mattersRow(false) : null}
            {untyped ? typesRow(!!mattersDue) : null}
          </Card>
        ) : null}
        {matters.total && (!mattersDue || !untyped || missing) ? (
          <Card style={toSort ? { marginTop: S.lg } : undefined}>
            {!mattersDue ? mattersRow(false) : null}
            {!untyped ? typesRow(!mattersDue) : null}
            {missing ? <Row title={t("settingsLists.categories.presets.title")} icon="plus.square.on.square" style={!mattersDue || !untyped ? styles.divider : undefined}
              subtitle={t("settingsLists.categories.presets.count", { count: missing })}
              onPress={() => router.push("/category/presets")} /> : null}
          </Card>
        ) : null}
        {groups.list.length ? (
          <>
            <SectionHeader>{t("settingsLists.categories.order.title")}</SectionHeader>
            <View style={styles.order}>
              <Segmented<CategoryOrder> value={order} onChange={setCategoryOrderSetting} options={[
                { value: "usage", label: t("settingsLists.categories.order.usage") },
                { value: "name", label: t("settingsLists.categories.order.name") },
                { value: "custom", label: t("settingsLists.categories.order.custom") },
              ]} />
            </View>
            {order === "custom" ? (
              <Card>
                <Row icon="line.3.horizontal" iconColor="#8E8E93" title={t("settingsLists.categories.order.reorder")} onPress={() => router.push("/category/reorder")} />
              </Card>
            ) : <ScreenNote>{order === "usage" ? t("settingsLists.categories.order.usageNote") : t("settingsLists.categories.order.nameNote")}</ScreenNote>}
          </>
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
  order: { paddingHorizontal: S.lg, paddingBottom: S.sm },
}));
