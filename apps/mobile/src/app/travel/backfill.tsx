import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { tagTransactions } from "@kopiyka/core";
import { mutate } from "@/store";
import { TransactionList, useTransactions } from "@/components/TransactionList";
import { BigButton, ModalHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";

/**
 * Right after a trip starts: pick earlier purchases that belong to it (flights, hotels),
 * so they count towards the budget. Recent expenses not yet carrying the tag, newest first.
 */
export default function TravelBackfill() {
  const { tag, name } = useLocalSearchParams<{ tag: string; name?: string }>();
  const [since] = useState(() => new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10));
  const rows = useTransactions("t.transfer_id IS NULL AND t.amount_minor<0 AND t.date>=? AND t.tag_ids NOT LIKE ?", [since, `%"${tag}"%`], 400);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = () => {
    if (selected.size) mutate((d) => tagTransactions(d, tag, [...selected]));
    router.back();
  };
  const n = selected.size;
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={`Already paid for ${name ?? "the trip"}?`} left={{ label: "Skip", onPress: () => router.back() }} right={{ label: n ? `Tag ${n}` : "Tag", onPress: apply, disabled: !n, bold: true }} />
      <TransactionList rows={rows} selected={selected} onToggle={toggle}
        header={<Text style={styles.hint}>Flights, hotels or tickets bought before leaving: tick them and they count towards the trip budget. You can add the tag to anything later too.</Text>} />
      <View style={styles.footer}><BigButton label={n ? `Tag ${n} transaction${n === 1 ? "" : "s"}` : "Nothing to add"} onPress={apply} disabled={!n} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.secondary, fontSize: 14, paddingHorizontal: S.lg, paddingBottom: S.md },
  footer: { padding: S.lg, paddingBottom: S.xl },
});
