import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { formatMinor, getRow, jsonIds, save } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { TransactionList, useTransactions } from "@/components/TransactionList";
import { ConfirmBar } from "@/components/Keypad";
import { ModalHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Which of a trip's payments stay outside its budget. Everything carrying the tag counts until it is
 * ticked here — the flights booked months ago usually do not belong in the money for the days
 * themselves, but a hotel paid ahead sometimes does, so it is chosen one by one rather than by date.
 * Ticked payments are still the trip's: its card says them as "outside the budget".
 */
export default function TripOutside() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = getRow(db, "budgets", id);
  const rows = useTransactions("t.transfer_id IS NULL AND t.recurring_id IS NULL AND t.amount_minor<0 AND t.tag_ids LIKE ?", [`%"${trip?.tag_id ?? ""}"%`], 1000);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(jsonIds(trip?.outside_ids)));
  const exit = useDiscardGuard(useDirty([[...selected].sort()]));
  const insets = useSafeAreaInsets();
  const toggle = (tx: string) => setSelected((s) => { const n = new Set(s); if (n.has(tx)) n.delete(tx); else n.add(tx); return n; });
  const done = () => {
    const b = getRow(db, "budgets", id);
    // Only ids that are still the trip's are kept, so a payment that lost the tag drops out of the list too.
    const live = new Set(rows.map((r) => r.id));
    if (b) mutate((d) => save(d, "budgets", { ...b, outside_ids: JSON.stringify([...selected].filter((x) => live.has(x))) }));
    exit(() => router.back());
  };
  const n = selected.size;
  const sum = rows.filter((r) => selected.has(r.id)).reduce((a, r) => (r.currency === trip?.currency ? a - r.amount_minor : a), 0);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title="Outside the budget" left={{ label: "Cancel", onPress: () => router.back() }} />
      <TransactionList rows={rows} selected={selected} onToggle={toggle}
        header={<Text style={styles.hint}>Tick what the budget was not meant for — the flights booked months ago, say. It is still part of the trip, just not of its budget.</Text>} />
      <View style={{ paddingTop: S.sm, paddingBottom: Math.max(insets.bottom, S.md) }}>
        <ConfirmBar amount={n ? `${n} outside${sum && trip ? ` · ${formatMinor(sum, trip.currency)} ${trip.currency}` : ""}` : "Everything counts"} label="Tap to save" onPress={done} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.secondary, fontSize: 14, paddingHorizontal: S.lg, paddingBottom: S.md },
});
