import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { TransactionList, useTransactions } from "@/components/TransactionList";
import { Money } from "@/components/ui";
import { ALL_TIME, EMPTY_FILTER, buildWhere } from "@/lib/filters";
import { C, S } from "@/constants/theme";

type Params = { category?: string; tag?: string; name: string };

/**
 * All-time transactions for one category (its subcategories included) or one tag, opened
 * from the category/tag editor. Lives inside the Settings stack so "back" returns there
 * instead of closing Settings. Rows open the global transaction sheet as usual.
 */
export default function SettingsTransactionsScreen() {
  const { category, tag, name } = useLocalSearchParams<Params>();
  const filter = useMemo(() => ({ ...EMPTY_FILTER, categories: category ? [category] : [], tags: tag ? [tag] : [], from: ALL_TIME }), [category, tag]);
  const { where, params } = buildWhere(filter, null);
  const rows = useTransactions(where, params, 5000);
  const sums = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (!r.transfer_id) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount_minor);
    return [...m.entries()];
  }, [rows]);
  return (
    <>
      <Stack.Screen options={{ title: name ?? "Transactions" }} />
      <TransactionList rows={rows} header={
        <View style={styles.head}>
          <Text style={styles.count}>{rows.length} transaction{rows.length === 1 ? "" : "s"}</Text>
          {sums.length ? <View style={styles.sums}>{sums.map(([cur, minor]) => <Money key={cur} minor={minor} currency={cur} colored style={styles.sum} />)}</View> : null}
        </View>
      } />
    </>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.sm, gap: 4 },
  count: { color: C.secondary, fontSize: 15 },
  sums: { flexDirection: "row", flexWrap: "wrap", gap: S.md },
  sum: { fontSize: 20, fontWeight: "700" },
});
