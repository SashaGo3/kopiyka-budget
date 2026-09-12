import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, getRow, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { TransactionList, useTransactions } from "@/components/TransactionList";
import { Money, Chip, ChipRow } from "@/components/ui";
import { C, S } from "@/constants/theme";

export default function AccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const acc = useQuery((db) => { const a = getRow(db, "accounts", id); return a ? { ...a, balance: accountBalanceMinor(db, a.id), planned: accountBalanceMinor(db, a.id, { includeFuture: true, includePending: true }) } : null; }, [id]);
  const rows = useTransactions("t.account_id=?", [id]);
  // A transfer needs somewhere to transfer to, so the chip only exists once a second account does.
  const canTransfer = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0").length > 1);
  if (!acc) return null;
  return (
    <>
      <Stack.Screen options={{ title: acc.name, headerRight: () => (
        <Pressable onPress={() => router.push({ pathname: "/account/edit", params: { id } })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit account"><SymbolView name="ellipsis.circle" size={22} tintColor={C.tint} /></Pressable>
      ) }} />
      <TransactionList rows={rows} showAccount={false} header={
        <View style={styles.head}>
          <Pressable onPress={() => router.push({ pathname: "/account/edit", params: { id } })} accessibilityRole="button" accessibilityLabel={`Balance ${acc.balance / 100} ${acc.currency}`} accessibilityHint="Adjust the balance">
            <Text style={styles.label}>Balance · tap to adjust</Text>
            <Money minor={acc.balance} currency={acc.currency} style={styles.value} />
          </Pressable>
          {acc.planned !== acc.balance ? <Text style={styles.pending}>After planned: <Money minor={acc.planned} currency={acc.currency} style={styles.pending} /></Text> : null}
          <ChipRow>
            <Chip label="Expense" icon="minus" onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: "new", account: id, kind: "expense" } })} />
            <Chip label="Income" icon="plus" onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: "new", account: id, kind: "income" } })} />
            {canTransfer ? <Chip label="Transfer" icon="arrow.left.arrow.right" onPress={() => router.push({ pathname: "/transfer/[id]", params: { id: "new", from: id } })} /> : null}
          </ChipRow>
        </View>
      } />
    </>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: S.lg, paddingBottom: S.sm, gap: 4 },
  label: { color: C.secondary, fontSize: 14, paddingHorizontal: S.xl },
  value: { fontSize: 32, fontWeight: "700", paddingHorizontal: S.xl },
  pending: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginBottom: S.sm },
});
