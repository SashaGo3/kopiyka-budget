import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { jsonIds, listRows, tripTagIds } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Empty, Row, ScreenNote, SectionHeader, TagPill } from "@/components/ui";
import { BarButton, BottomBar } from "@/components/BottomBar";
import { C, S } from "@/constants/theme";

/**
 * Tags, with the categories each one is limited to. The tags travel mode made are a list of their
 * own, above the archived ones: each is one journey rather than a way of filing things, and mixed
 * in with #work and #gift they read as clutter.
 */
export default function TagsScreen() {
  const tags = useQuery((db) => {
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c.name]));
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
      <Stack.Screen options={{ title: "Tags" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <ScreenNote>A tag cuts across categories, where a category says what the money was for: #work lunch, #vacation fuel. A tag can be limited to the categories it makes sense in, a budget can be set on one, and travel mode tags a whole journey for you.</ScreenNote>
        {tags.length === 0 ? <Empty title="No tags" hint="Nothing tagged yet." /> : null}
        {live.length ? (
          <Card style={{ marginTop: S.lg }}>
            {live.map((t, i) => (
              <Row key={t.id} title={t.name} subtitle={`${t.uses} use${t.uses === 1 ? "" : "s"}${t.scope ? ` · only for ${t.scope}` : " · any category"}`} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                right={<View style={styles.right}><TagPill name={t.name} color={t.color} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
            ))}
          </Card>
        ) : null}
        {travel.length ? <SectionHeader>Travel</SectionHeader> : null}
        {travel.length ? (
          <Card>
            {travel.map((t, i) => (
              <Row key={t.id} icon="airplane" iconColor="#0A84FF" title={t.name} subtitle={`${t.uses} use${t.uses === 1 ? "" : "s"}`} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                right={<View style={styles.right}><TagPill name={t.name} color={t.color} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
            ))}
          </Card>
        ) : null}
        {archived.length ? <SectionHeader>Archived</SectionHeader> : null}
        {archived.length ? (
          <Card>
            {archived.map((t, i) => (
              <Row key={t.id} title={t.name} subtitle={`${t.uses} use${t.uses === 1 ? "" : "s"} · archived`} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={[i > 0 ? styles.divider : undefined, { opacity: 0.6 }]}
                right={<View style={styles.right}><TagPill name={t.name} color={t.color} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
            ))}
          </Card>
        ) : null}
        {archived.length ? <ScreenNote>Transactions keep these tags and budgets on them still count; they are just not offered for anything new. Open one to bring it back.</ScreenNote> : null}
      </ScrollView>
      <BottomBar><BarButton icon="plus" label="Add tag" onPress={() => router.push({ pathname: "/tag/edit", params: { id: "new" } })} a11y="Add tag" /></BottomBar>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  right: { flexDirection: "row", alignItems: "center", gap: 8 },
});
