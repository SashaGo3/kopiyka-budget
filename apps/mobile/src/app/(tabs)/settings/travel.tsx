import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { listTrips } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Row, ScreenNote, SectionHeader } from "@/components/ui";
import { TripCard } from "@/components/TripCard";
import { tripLook } from "@/lib/travel";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Trips & Events: the one place a trip or an event is started, changed, ended or added after the
 * fact. The two are one thing to the numbers (core `tripKind`); only one runs at a time. The trip card on
 * Transactions and the history on Budgets only show; every card here opens that trip's own screen
 * (`settings/trip.tsx`) with everything that can be changed about it.
 */
export default function TravelSettings() {
  const trips = useQuery((d) => listTrips(d));
  const active = trips.find((x) => !x.ended) ?? null;
  const past = trips.filter((x) => x.ended);
  const openTrip = (id: string) => router.push({ pathname: "/settings/trip", params: { id } });
  return (
    <>
      <Stack.Screen options={{ title: t("travel.settings.title"), headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120 }}>
        <ScreenNote more={t("travel.settings.noteMore")}>{t("travel.settings.noteShort")}</ScreenNote>
        {active ? (
          <>
            <SectionHeader>{t("travel.settings.now")}</SectionHeader>
            <TripCard budget={active} onPress={() => openTrip(active.id)} />
          </>
        ) : null}
        {/* One way in for each kind; whether it is happening now or already over is asked in the sheet. */}
        <Card style={{ marginTop: S.lg }}>
          <Row icon={tripLook("trip").icon} iconColor={tripLook("trip").color} title={t("travel.settings.start")} subtitle={active ? t("travel.settings.addHintRunning") : t("travel.settings.startHint")} onPress={() => router.push("/travel/start")} />
          <Row icon={tripLook("event").icon} iconColor={tripLook("event").color} title={t("travel.settings.startEvent")} subtitle={active ? t("travel.settings.addHintRunning") : t("travel.settings.startEventHint")} style={styles.divider}
            onPress={() => router.push({ pathname: "/travel/start", params: { kind: "event" } })} />
        </Card>
        {past.length ? <SectionHeader>{t("travel.settings.history")}</SectionHeader> : null}
        {past.map((x) => <View key={x.id}><TripCard budget={x} compact onPress={() => openTrip(x.id)} /></View>)}
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
