import { FlatList, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { Money, Row, accountIcon } from "@/components/ui";
import { C, S } from "@/constants/theme";

export default function PickAccount() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name").map((a) => ({ ...a, balance: accountBalanceMinor(db, a.id) })));
  return (
    <FlatList style={{ flex: 1, backgroundColor: C.bgGrouped }} data={accounts} keyExtractor={(a) => a.id} contentContainerStyle={{ paddingTop: S.sm, paddingBottom: 60 }}
      ListHeaderComponent={<Text style={styles.title}>Account</Text>}
      renderItem={({ item: a }) => (
        <Row title={a.name} subtitle={a.group_name || undefined} icon={accountIcon(a.type)} iconColor={a.color ?? undefined} style={{ backgroundColor: "transparent" }}
          onPress={() => { resolvePick(key, a.id); router.back(); }}
          right={<View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}><Money minor={a.balance} currency={a.currency} style={{ color: C.secondary, fontSize: 15 }} />{selected === a.id ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : null}</View>} />
      )} />
  );
}
const styles = StyleSheet.create({ title: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingVertical: S.md } });
