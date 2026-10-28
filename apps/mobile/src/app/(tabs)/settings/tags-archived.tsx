import { ScrollView, StyleSheet } from "react-native";
import { Stack, router } from "expo-router";
import { Card, Empty, Row, ScreenNote, TagPill } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { useTagList } from "@/lib/tagList";
import { tripLook } from "@/lib/travel";
import { t as tr } from "@/i18n";

/**
 * Archived tags (DATA.md rule 14): no longer offered, still counted. Opened from the foot of
 * Settings → Tags; a tag is restored from its own sheet. A trip's tag keeps its kind's icon here.
 */
export default function ArchivedTagsScreen() {
  const { archived } = useTagList();
  return (
    <>
      <Stack.Screen options={{ title: tr("settingsLists.tags.archived") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120 }}>
        <ScreenNote>{tr("settingsLists.tags.archivedNote")}</ScreenNote>
        {archived.length === 0 ? <Empty title={tr("settingsLists.tags.emptyTitle")} hint={tr("settingsLists.tags.emptyHint")} /> : null}
        {archived.length ? (
          <Card style={{ marginTop: S.lg }}>
            {archived.map((t, i) => (
              <Row key={t.id} {...(t.trip ? { icon: tripLook(t.trip).icon, iconColor: tripLook(t.trip).color } : null)} title={t.name}
                subtitle={tr("settingsLists.tags.usesArchived", { count: t.uses })}
                onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={[i > 0 ? styles.divider : undefined, { opacity: 0.6 }]}
                titleNode={<TagPill name={t.name} color={t.color} />} />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
