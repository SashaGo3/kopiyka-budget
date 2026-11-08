import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Stack, router } from "expo-router";
import { Card, Empty, Row, ScreenNote, TagPill } from "@/components/ui";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { C, S, themed } from "@/constants/theme";
import { usedWithLine, useTagList } from "@/lib/tagList";
import { t as tr } from "@/i18n";

/**
 * Tags, most used first, with the categories each one is limited to and the ones it is actually used
 * with. The search in the header looks through every tag — trip and archived ones too, since a name
 * typed is a tag being looked for wherever it lives. Each row is the tag as it looks on a
 * transaction — its pill — rather than its name printed and then drawn again beside it. The tags
 * travel mode made, and the archived ones, are a page each, opened from the foot of the list: a trip
 * tag is one journey rather than a way of filing things, an archived one is no longer offered, and
 * mixed in with #work and #gift both read as clutter.
 */
export default function TagsScreen() {
  // The Add bar slides away while scrolling down, as on Transactions, and comes back on the way up.
  const { visible, onScroll } = useScrollHide();
  const { live, travel, archived } = useTagList();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const found = query ? [...live, ...travel, ...archived].filter((tg) => tg.name.toLowerCase().includes(query)) : null;
  const subtitle = (tg: (typeof live)[number]) => {
    const head = tg.scope ? tr("settingsLists.tags.usesOnly", { count: tg.uses, categories: tg.scope }) : tr("settingsLists.tags.usesAny", { count: tg.uses });
    return tg.usedWith.length ? `${head}\n${tr("settingsLists.tags.usedWith", { categories: usedWithLine(tg.usedWith) })}` : head;
  };
  return (
    <>
      <Stack.Screen options={{ title: tr("settingsLists.tags.title"),
        headerSearchBarOptions: { placeholder: tr("settingsLists.tags.search"), hideWhenScrolling: true,
          onChangeText: (e) => setQ(e?.nativeEvent?.text ?? ""), onCancelButtonPress: () => setQ("") } }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={tr("settingsLists.tags.introMore")}>{tr("settingsLists.tags.introShort")}</ScreenNote>
        {!found && live.length === 0 ? <Empty title={tr("settingsLists.tags.emptyTitle")} hint={tr("settingsLists.tags.emptyHint")} /> : null}
        {found ? (
          found.length ? (
            <Card style={{ marginTop: S.lg }}>
              {found.map((t, i) => (
                <Row key={t.id} title={t.name} subtitle={subtitle(t)} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                  titleNode={<TagPill name={t.name} color={t.color} />} />
              ))}
            </Card>
          ) : <Empty title={tr("settingsLists.tags.noMatch", { query: q.trim() })} hint={tr("settingsLists.tags.noMatchHint")} />
        ) : null}
        {!found && live.length ? (
          <Card style={{ marginTop: S.lg }}>
            {live.map((t, i) => (
              <Row key={t.id} title={t.name} subtitle={subtitle(t)} onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
                titleNode={<TagPill name={t.name} color={t.color} />} />
            ))}
          </Card>
        ) : null}
        {!found && (travel.length || archived.length) ? (
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
