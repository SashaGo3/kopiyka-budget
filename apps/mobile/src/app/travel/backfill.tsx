import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { tagTransactions } from "@kopiyka/core";
import { mutate } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { TransactionList, useTransactions } from "@/components/TransactionList";
import { BigButton, ModalHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { EMPTY_FILTER, activeCount, buildWhere, type TxFilter } from "@/lib/filters";
import { useDirty, useDiscardGuard } from "@/lib/discard";

/**
 * Right after travel mode starts: pick earlier purchases that belong to the trip (flights, hotels),
 * so they count towards its budget. Expenses not yet carrying the tag, newest first — the last 120
 * days unless the filter says otherwise, and never a recurring payment, which the trip does not
 * count anyway (trips.ts).
 *
 * A search field and the Transactions filter sheet, because the flight bought two months ago is one
 * row among hundreds: "ryanair" finds it faster than scrolling does. Ticks survive both — narrowing
 * the list to find the hotel does not forget the flight.
 */
export default function TravelBackfill() {
  const { tag, name } = useLocalSearchParams<{ tag: string; name?: string }>();
  const [since] = useState(() => new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TxFilter>(EMPTY_FILTER);
  const key = useMemo(() => newPickKey("bfilter"), []);
  usePickResult<TxFilter>(key, useCallback((f: TxFilter) => setFilter(f), []));
  const { where, params } = buildWhere({ ...filter, q, ...(!filter.from && !filter.to ? { from: since } : {}) }, null);
  const rows = useTransactions(`t.transfer_id IS NULL AND t.amount_minor<0 AND t.recurring_id IS NULL AND t.tag_ids NOT LIKE ? AND ${where}`, [`%"${tag}"%`, ...params], 400);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Ticks are work too: leaving with some and without adding them asks first (lib/discard.ts).
  const exit = useDiscardGuard(selected.size > 0);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = () => {
    if (selected.size) mutate((d) => tagTransactions(d, tag, [...selected]));
    exit(() => router.back());
  };
  const n = selected.size;
  const filters = activeCount(filter);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={`Already paid for ${name ?? "it"}?`} left={{ label: "Skip", onPress: () => router.back() }} />
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search notes, shops, amounts" placeholderTextColor={C.tertiary} style={styles.input}
            autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel="Search transactions" />
        </View>
        <Pressable onPress={() => router.push({ pathname: "/filter", params: { key, value: JSON.stringify(filter) } })} hitSlop={6}
          style={[styles.filter, filters > 0 && styles.filterOn]} accessibilityRole="button" accessibilityLabel={filters ? `Filters, ${filters} on` : "Filters"}>
          <SymbolView name="line.3.horizontal.decrease" size={17} tintColor={filters ? C.onTint : C.tint} />
          {filters ? <Text style={styles.filterCount}>{filters}</Text> : null}
        </Pressable>
      </View>
      <TransactionList rows={rows} selected={selected} onToggle={toggle}
        header={<Text style={styles.hint}>Flights, hotels or tickets bought before leaving: tick them and they count towards the travel budget. You can add the tag to anything later too.</Text>} />
      <View style={styles.footer}><BigButton label={n ? `Add ${n} to ${name ?? "the travel"}` : "Nothing to add"} onPress={apply} disabled={!n} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.secondary, fontSize: 14, paddingHorizontal: S.lg, paddingBottom: S.md },
  footer: { padding: S.lg, paddingBottom: S.xl },
  searchRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingBottom: S.sm },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  filter: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, minWidth: 40, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.fill, justifyContent: "center" },
  filterOn: { backgroundColor: C.tint },
  filterCount: { color: C.onTint, fontSize: 14, fontWeight: "700" },
});
