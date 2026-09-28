import { useCallback, useMemo } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { formatMinor, fromMinor, getRow, jsonIds, rateOrFallback, remove, save, toMinor, tripStats, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, DeleteRow, Row, SectionHeader } from "@/components/ui";
import { TripCard } from "@/components/TripCard";
import { C, S } from "@/constants/theme";
import { humanDayTime } from "@/lib/dates";
import { endTravel, tripLine } from "@/lib/travel";
import { nextDay } from "@/lib/filters";

/**
 * One trip, and everything that can be changed about it: its budget (a trip rarely costs what was
 * guessed on the way to the airport), its currency, its dates, which of its payments stay outside
 * the budget, the purchases that belong to it — and ending it, or, once it is
 * history, removing it. The card at the top is the same one Transactions shows.
 */
export default function TripSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useQuery((d) => getRow(d, "budgets", id) ?? null, [id]);
  const s = useQuery((d) => (trip ? tripStats(d, trip) : null), [trip?.id, trip?.updated_at]);
  const keys = useMemo(() => ({ amount: newPickKey("tripamt"), currency: newPickKey("tripcur") }), []);
  const change = useCallback((patch: Partial<Budget>) => {
    const b = getRow(db, "budgets", id);
    if (b) mutate((d) => save(d, "budgets", { ...b, ...patch }));
  }, [id]);
  usePickResult<number>(keys.amount, useCallback((minor: number) => change({ amount_minor: minor }), [change]));
  // Another currency keeps the same budget, converted at today's rate; with no rate there is
  // nothing honest to convert it with, so it is refused rather than guessed.
  usePickResult<string>(keys.currency, useCallback((next: string) => {
    const b = getRow(db, "budgets", id);
    if (!b || next === b.currency) return;
    void rateOrFallback(db, b.currency, next).then((r) => {
      if (!r) { Alert.alert(`No exchange rate for ${next}`, "Connect to the internet once, or keep the budget in its currency."); return; }
      change({ currency: next, amount_minor: toMinor(Math.round(fromMinor(b.amount_minor, b.currency) * r.rate * 100) / 100, next) });
    }).catch(() => Alert.alert(`No exchange rate for ${next}`));
  }, [id, change]));

  if (!trip || trip.deleted || !s) return <Stack.Screen options={{ title: "Travel" }} />;
  const active = !trip.ended;
  const outsideCount = jsonIds(trip.outside_ids).length;
  const fmt = (m: number) => `${formatMinor(m, trip.currency)} ${trip.currency}`;
  const last = trip.ended ?? trip.ends ?? trip.starts;
  // A past trip's purchases are looked for in its own days; a running one's in the months before it.
  const addPurchases = () => router.push({ pathname: "/travel/backfill", params: { tag: trip.tag_id ?? "", name: s.name,
    ...(active ? {} : { from: trip.starts, to: nextDay(last) }) } });
  const end = () => Alert.alert(`End travel mode for ${s.name}?`, `${tripLine(s)}. New expenses stop getting the “${s.name}” tag; it stays here as history.`, [
    { text: "Keep travelling", style: "cancel" },
    { text: "End it", style: "destructive", onPress: () => endTravel(trip.id) },
  ]);
  const del = () => Alert.alert(`Remove ${s.name}?`, "Only the travel budget goes. The tag and every transaction with it stay.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => { mutate((d) => remove(d, "budgets", trip.id)); router.back(); } },
  ]);

  return (
    <>
      <Stack.Screen options={{ title: s.name }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: S.md, paddingBottom: 120 }}>
        <TripCard budget={trip} />
        <SectionHeader>Budget</SectionHeader>
        <Card>
          <Row icon="banknote" iconColor="#34C759" title="Amount" subtitle={fmt(trip.amount_minor)}
            onPress={() => router.push({ pathname: "/pick/amount", params: { key: keys.amount, title: `Budget for ${s.name}`, currency: trip.currency, value: String(trip.amount_minor) } })} />
          <Row icon="dollarsign.circle" iconColor="#0A84FF" title="Currency" subtitle={`${trip.currency} · payments in any currency are converted`} style={styles.divider}
            onPress={() => router.push({ pathname: "/pick/currency", params: { key: keys.currency, selected: trip.currency, title: "Budget currency" } })} />
          <Row icon="calendar" iconColor="#FF9F0A" title="Dates" subtitle={`${humanDayTime(trip.starts, null, undefined, true)} → ${humanDayTime(last, null, undefined, true)}`} style={styles.divider}
            onPress={() => router.push({ pathname: "/travel/dates", params: { budget: trip.id } })} />
        </Card>
        <SectionHeader>Transactions</SectionHeader>
        <Card>
          <Row icon="plus.circle" iconColor="#0A84FF" title="Add purchases to it" subtitle={active ? "Flights, hotels, tickets bought beforehand" : "Pick the ones from those days"} onPress={addPurchases} />
          <Row icon="rectangle.portrait.and.arrow.right" iconColor="#5E5CE6" title="Outside the budget" style={styles.divider}
            subtitle={outsideCount ? `${outsideCount} payment${outsideCount === 1 ? "" : "s"} · ${fmt(s.outside_minor)}` : "Everything counts"}
            onPress={() => router.push({ pathname: "/travel/outside", params: { id: trip.id } })} />
        </Card>
        <Text style={styles.hint}>Paid for the trip but not from its budget — the flights booked months ago, say. Choose them one by one.</Text>
        {active ? (
          <Card style={{ marginTop: S.xl }}>
            <Row icon="stop.circle" iconColor="#FF3B30" title="End travel mode" subtitle="New expenses stop getting the travel tag" destructive onPress={end} />
          </Card>
        ) : (
          <View style={{ marginTop: S.xl }}><DeleteRow label="Remove this travel" onPress={del} /></View>
        )}
      </ScrollView>
    </>
  );
}


const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, paddingTop: S.sm },
});
