import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { listTrips } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Row, ScreenNote, SectionHeader } from "@/components/ui";
import { TripCard } from "@/components/TripCard";
import { C, S } from "@/constants/theme";

/**
 * Travel: the one place a trip is started, changed, ended or added after the fact. The trip card on
 * Transactions and the history on Budgets only show; every card here opens that trip's own screen
 * (`settings/trip.tsx`) with everything that can be changed about it.
 */
export default function TravelSettings() {
  const trips = useQuery((d) => listTrips(d));
  const active = trips.find((t) => !t.ended) ?? null;
  const past = trips.filter((t) => t.ended);
  const openTrip = (id: string) => router.push({ pathname: "/settings/trip", params: { id } });
  return (
    <>
      <Stack.Screen options={{ title: "Travel", headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120 }}>
        <ScreenNote>While travel mode is on, every new expense gets the travel’s tag and counts towards its budget, whatever currency it was paid in. Travel spending stays out of your monthly budgets.</ScreenNote>
        {active ? (
          <>
            <SectionHeader>Now</SectionHeader>
            <TripCard budget={active} onPress={() => openTrip(active.id)} />
          </>
        ) : null}
        <Card style={{ marginTop: S.lg }}>
          {active ? null : <Row icon="airplane" iconColor="#0A84FF" title="Start travel mode" subtitle="Where, how much, and the dates" onPress={() => router.push("/travel/start")} />}
          <Row icon="clock.arrow.circlepath" iconColor="#8E8E93" title="Add a past travel" subtitle="A trip that already happened, and what it cost"
            onPress={() => router.push({ pathname: "/travel/start", params: { past: "1" } })} style={active ? undefined : styles.divider} />
        </Card>
        {past.length ? <SectionHeader>History</SectionHeader> : null}
        {past.map((t) => <View key={t.id}><TripCard budget={t} compact onPress={() => openTrip(t.id)} /></View>)}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
});
