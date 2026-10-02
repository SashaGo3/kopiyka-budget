import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { tagTransactions } from "@kopiyka/core";
import { mutate } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { TransactionList, useTransactions } from "@/components/TransactionList";
import { ModalHeader } from "@/components/ui";
import { ConfirmBar } from "@/components/Keypad";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, S } from "@/constants/theme";
import { EMPTY_FILTER, activeCount, buildWhere, type TxFilter } from "@/lib/filters";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";

/**
 * Right after travel mode starts: pick earlier purchases that belong to the trip (flights, hotels),
 * so they count towards its budget. Expenses not yet carrying the tag, newest first — the last 120
 * days unless the filter says otherwise, and never a recurring payment, which the trip does not
 * count anyway (trips.ts).
 *
 * For a trip recorded after the fact (`from`/`to`), the list is its own days instead, and Select all
 * is there because then most of them usually are the trip.
 *
 * A search field and the Transactions filter sheet, because the flight bought two months ago is one
 * row among hundreds: "ryanair" finds it faster than scrolling does. Ticks survive both — narrowing
 * the list to find the hotel does not forget the flight.
 */
export default function TravelBackfill() {
  const { tag, name, from, to } = useLocalSearchParams<{ tag: string; name?: string; from?: string; to?: string }>();
  const [since] = useState(() => new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TxFilter>(EMPTY_FILTER);
  const key = useMemo(() => newPickKey("bfilter"), []);
  usePickResult<TxFilter>(key, useCallback((f: TxFilter) => setFilter(f), []));
  const { where, params } = buildWhere({ ...filter, q, ...(!filter.from && !filter.to ? (from ? { from, to: to ?? null } : { from: since }) : {}) }, null);
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
  const insets = useSafeAreaInsets();
  const filters = activeCount(filter);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={from ? (name ? t("travel.backfill.whatWasName", { name }) : t("travel.backfill.whatWas")) : (name ? t("travel.backfill.paidName", { name }) : t("travel.backfill.paid"))} left={{ label: t("travel.backfill.skip"), onPress: () => router.back() }}
        right={rows.length ? (n === rows.length ? { label: t("travel.backfill.selectNone"), bold: false, onPress: () => setSelected(new Set()) } : { label: t("travel.backfill.selectAll"), bold: false, onPress: () => setSelected(new Set(rows.map((r) => r.id))) }) : undefined} />
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
          <TextInput value={q} onChangeText={setQ} placeholder={t("travel.backfill.search")} placeholderTextColor={C.tertiary} style={styles.input}
            autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel={t("travel.backfill.searchLabel")} />
        </View>
        <Pressable onPress={() => router.push({ pathname: "/filter", params: { key, value: JSON.stringify(filter) } })} hitSlop={6}
          style={[styles.filter, filters > 0 && styles.filterOn]} accessibilityRole="button" accessibilityLabel={filters ? t("travel.backfill.filtersOn", { count: filters }) : t("travel.backfill.filters")}>
          <SymbolView name="line.3.horizontal.decrease" size={17} tintColor={filters ? C.onTint : C.tint} />
          {filters ? <Text style={styles.filterCount}>{filters}</Text> : null}
        </Pressable>
      </View>
      <TransactionList rows={rows} selected={selected} onToggle={toggle}
        header={<Text style={styles.hint}>{from ? t("travel.backfill.hintPast") : t("travel.backfill.hint")}</Text>} />
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <ConfirmBar amount={n ? t("travel.backfill.selected", { count: n }) : t("travel.backfill.noneSelected")} label={n ? (name ? t("travel.backfill.addToName", { name }) : t("travel.backfill.addTo")) : t("travel.backfill.tick")} onPress={apply} disabled={!n} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.secondary, fontSize: 14, paddingHorizontal: S.lg, paddingBottom: S.md },
  footer: { paddingTop: S.sm },
  searchRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingBottom: S.sm },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  filter: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, minWidth: 40, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.fill, justifyContent: "center" },
  filterOn: { backgroundColor: C.tint },
  filterCount: { color: C.onTint, fontSize: 14, fontWeight: "700" },
});
