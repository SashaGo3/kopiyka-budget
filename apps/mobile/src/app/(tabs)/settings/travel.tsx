import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { listTrips } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Row, ScreenNote, SectionHeader } from "@/components/ui";
import { TripCard } from "@/components/TripCard";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Travel: the one place a trip is started, changed, ended or added after the fact. The trip card on
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
        <Card style={{ marginTop: S.lg }}>
          {active ? null : <Row icon="airplane" iconColor="#0A84FF" title={t("travel.settings.start")} subtitle={t("travel.settings.startHint")} onPress={() => router.push("/travel/start")} />}
          <Row icon="clock.arrow.circlepath" iconColor="#8E8E93" title={t("travel.settings.addPast")} subtitle={t("travel.settings.addPastHint")}
            onPress={() => router.push({ pathname: "/travel/start", params: { past: "1" } })} style={active ? undefined : styles.divider} />
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
