import { ScrollView, StyleSheet } from "react-native";
import { Stack, router } from "expo-router";
import { jsonIds, listRows, tripTagIds } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Empty, Row, ScreenNote, SectionHeader, TagPill } from "@/components/ui";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { C, S, themed } from "@/constants/theme";
import { catName } from "@/lib/names";
import { t as tr } from "@/i18n";

/**
 * Tags, with the categories each one is limited to. Each row is the tag as it looks on a
 * transaction — its pill — rather than its name printed and then drawn again beside it. The tags travel mode made are a list of their
 * own, above the archived ones: each is one journey rather than a way of filing things, and mixed
 * in with #work and #gift they read as clutter.
 */
export default function TagsScreen() {
  // The Add bar slides away while scrolling down, as on Transactions, and comes back on the way up.
  const { visible, onScroll } = useScrollHide();
  const tags = useQuery((db) => {
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, catName(c)]));
    const usage = new Map<string, number>();
    for (const r of db.all<{ tag_ids: string }>(`SELECT tag_ids FROM transactions WHERE deleted=0 AND tag_ids<>'[]'`)) for (const id of jsonIds(r.tag_ids)) usage.set(id, (usage.get(id) ?? 0) + 1);
    const travel = new Set(tripTagIds(db));
    return listRows(db, "tags", "deleted=0", [], "name").map((t) => ({ ...t, travel: travel.has(t.id), uses: usage.get(t.id) ?? 0, scope: jsonIds(t.category_ids).map((id) => cats.get(id)).filter(Boolean).join(", ") }));
  });
  const live = tags.filter((t) => !t.archived && !t.travel);
  const travel = tags.filter((t) => !t.archived && t.travel);
  const archived = tags.filter((t) => t.archived);
  return (
    <>
      <Stack.Screen options={{ title: tr("settingsLists.tags.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={tr("settingsLists.tags.introMore")}>{tr("settingsLists.tags.introShort")}</ScreenNote>
        {tags.length === 0 ? <Empty title={tr("settingsLists.tags.emptyTitle")} hint={tr("settingsLists.tags.emptyHint")} /> : null}
        {live.length ? (
          <Card style={{ marginTop: S.lg }}>
            {live.map((t, i) => (
              <Row key={t.id} title={t.name} subtitle={t.scope ? tr("settingsLists.tags.usesOnly", { count: t.uses, categories: t.scope }) : tr("settingsLists.tags.usesAny", { count: t.uses })} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                titleNode={<TagPill name={t.name} color={t.color} />} />
            ))}
          </Card>
        ) : null}
        {travel.length ? <SectionHeader>{tr("settingsLists.tags.travel")}</SectionHeader> : null}
        {travel.length ? (
          <Card>
            {travel.map((t, i) => (
              <Row key={t.id} icon="airplane" iconColor="#0A84FF" title={t.name} subtitle={tr("settingsLists.tags.uses", { count: t.uses })} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                titleNode={<TagPill name={t.name} color={t.color} />} />
            ))}
          </Card>
        ) : null}
        {archived.length ? <SectionHeader>{tr("settingsLists.tags.archived")}</SectionHeader> : null}
        {archived.length ? (
          <Card>
            {archived.map((t, i) => (
              <Row key={t.id} title={t.name} subtitle={tr("settingsLists.tags.usesArchived", { count: t.uses })} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={[i > 0 ? styles.divider : undefined, { opacity: 0.6 }]}
                titleNode={<TagPill name={t.name} color={t.color} />} />
            ))}
          </Card>
        ) : null}
        {archived.length ? <ScreenNote>{tr("settingsLists.tags.archivedNote")}</ScreenNote> : null}
      </ScrollView>
      <BottomBar visible={visible}><BarButton icon="plus" label={tr("settingsLists.tags.add")} onPress={() => router.push({ pathname: "/tag/edit", params: { id: "new" } })} a11y={tr("settingsLists.tags.add")} /></BottomBar>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
