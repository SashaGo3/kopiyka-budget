import { ScrollView, StyleSheet } from "react-native";
import { Stack, router } from "expo-router";
import { Card, Empty, Row, ScreenNote, TagPill } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { useTagList } from "@/lib/tagList";
import { tripLook } from "@/lib/travel";
import { t as tr } from "@/i18n";

/**
 * The tags travel mode made, one per trip or event, each drawn with its kind's icon (`tripLook`:
 * a plane for a trip, a party popper for an event). Opened from the foot of Settings → Tags.
 */
export default function TravelTagsScreen() {
  const { travel } = useTagList();
  return (
    <>
      <Stack.Screen options={{ title: tr("settingsLists.tags.travel") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120 }}>
        <ScreenNote>{tr("settingsLists.tags.travelNote")}</ScreenNote>
        {travel.length === 0 ? <Empty title={tr("settingsLists.tags.emptyTitle")} hint={tr("settingsLists.tags.emptyHint")} /> : null}
        {travel.length ? (
          <Card style={{ marginTop: S.lg }}>
            {travel.map((t, i) => (
              <Row key={t.id} icon={tripLook(t.trip).icon} iconColor={tripLook(t.trip).color} title={t.name}
                subtitle={tr("settingsLists.tags.usesKind", { count: t.uses, kind: t.trip ?? "trip" })}
                onPress={() => router.push({ pathname: "/tag/edit", params: { id: t.id } })} style={i > 0 ? styles.divider : undefined}
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
