import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { Card, Empty, Row, ScreenNote, Segmented, TagPill } from "@/components/ui";
import { getTagOrder, setTagOrder, type TagOrder } from "@/lib/settings";
import { useQuery } from "@/store";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { C, S, themed } from "@/constants/theme";
import { usedWithLine, useTagList } from "@/lib/tagList";
import { t as tr } from "@/i18n";

/**
 * Tags, with the categories each one is limited to and the ones it is actually used with, most used
 * first unless switched to alphabetical. Each row is the tag as it looks on a
 * transaction — its pill — rather than its name printed and then drawn again beside it. The tags
 * travel mode made, and the archived ones, are a page each, opened from the foot of the list: a trip
 * tag is one journey rather than a way of filing things, an archived one is no longer offered, and
 * mixed in with #work and #gift both read as clutter.
 */
export default function TagsScreen() {
  // The Add bar slides away while scrolling down, as on Transactions, and comes back on the way up.
  const { visible, onScroll } = useScrollHide();
  const { live, travel, archived } = useTagList();
  const order = useQuery(() => getTagOrder());
  const subtitle = (tg: (typeof live)[number]) => {
    const head = tg.scope ? tr("settingsLists.tags.usesOnly", { count: tg.uses, categories: tg.scope }) : tr("settingsLists.tags.usesAny", { count: tg.uses });
    return tg.usedWith.length ? `${head}\n${tr("settingsLists.tags.usedWith", { categories: usedWithLine(tg.usedWith) })}` : head;
  };
  return (
    <>
      <Stack.Screen options={{ title: tr("settingsLists.tags.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={tr("settingsLists.tags.introMore")}>{tr("settingsLists.tags.introShort")}</ScreenNote>
        {live.length === 0 ? <Empty title={tr("settingsLists.tags.emptyTitle")} hint={tr("settingsLists.tags.emptyHint")} /> : null}
        {live.length > 1 ? (
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.md }}>
            <Segmented<TagOrder> value={order} onChange={setTagOrder} options={[
              { value: "usage", label: tr("settingsLists.categories.order.usage") },
              { value: "name", label: tr("settingsLists.categories.order.name") },
            ]} />
          </View>
        ) : null}
        {live.length ? (
          <Card style={{ marginTop: S.lg }}>
            {live.map((t, i) => (
              <Row key={t.id} title={t.name} subtitle={subtitle(t)} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                titleNode={<TagPill name={t.name} color={t.color} />} />
            ))}
          </Card>
        ) : null}
        {travel.length || archived.length ? (
          <Card style={{ marginTop: S.lg }}>
            {travel.length ? <Row icon="suitcase.fill" iconColor="#0A84FF" title={tr("settingsLists.tags.travel")} subtitle={tr("settingsLists.tags.count", { count: travel.length })} onPress={() => router.push({ pathname: "/settings/tags-travel" })} /> : null}
            {archived.length ? <Row icon="archivebox" iconColor="#8E8E93" title={tr("settingsLists.tags.archived")} subtitle={tr("settingsLists.tags.count", { count: archived.length })} onPress={() => router.push({ pathname: "/settings/tags-archived" })} style={travel.length ? styles.divider : undefined} /> : null}
          </Card>
        ) : null}
      </ScrollView>
      <BottomBar visible={visible}><BarButton icon="plus" label={tr("settingsLists.tags.add")} onPress={() => router.push({ pathname: "/tag/edit", params: { id: "new" } })} a11y={tr("settingsLists.tags.add")} /></BottomBar>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
