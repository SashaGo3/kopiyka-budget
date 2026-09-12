import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { debtTotals, isOverdue, listDebts, listRows, type Debt, type DebtTotal } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Empty, Money, Row, ScreenNote, SectionHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";

type DebtWithAccount = Debt & { accountName?: string };

export default function DebtsSettings() {
  const data = useQuery((db) => {
    const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a.name]));
    const debts = listDebts(db).map((d): DebtWithAccount => ({ ...d, accountName: d.account_id ? accounts.get(d.account_id) : undefined }));
    return { debts, totals: debtTotals(debts) };
  });
  const today = todayLocal();
  const owedToMe = data.debts.filter((d) => !d.settled_date && d.direction === "owed_to_me");
  const iOwe = data.debts.filter((d) => !d.settled_date && d.direction === "i_owe");
  const settled = data.debts.filter((d) => d.settled_date);

  return (
    <>
      <Stack.Screen options={{ title: "Debts", headerLargeTitle: true, headerRight: () => <Pressable onPress={() => router.push({ pathname: "/debt/edit", params: { id: "new" } })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add"><SymbolView name="plus" size={20} tintColor={C.tint} /></Pressable> }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <ScreenNote>Money lent to someone, or borrowed from them. A debt is not a transaction and touches no balance — it becomes one only when it is actually paid, which settling it here writes for you. Give it a due date and a reminder fires the day before and on the day, at a time you choose.</ScreenNote>
        {data.totals.length ? <Summary totals={data.totals} /> : <Empty title="Nothing owed either way" hint="Tap + to record one." />}
        {owedToMe.length ? <SectionHeader>Owed to you</SectionHeader> : null}
        {owedToMe.length ? <Card>{owedToMe.map((d, i) => <DebtRow key={d.id} d={d} first={i === 0} today={today} />)}</Card> : null}
        {iOwe.length ? <SectionHeader>You owe</SectionHeader> : null}
        {iOwe.length ? <Card>{iOwe.map((d, i) => <DebtRow key={d.id} d={d} first={i === 0} today={today} />)}</Card> : null}
        {settled.length ? <SectionHeader>Settled</SectionHeader> : null}
        {settled.length ? <Card>{settled.map((d, i) => <DebtRow key={d.id} d={d} first={i === 0} today={today} settled />)}</Card> : null}
      </ScrollView>
    </>
  );
}

/** Per-currency, never added together: what is owed to the user and what the user owes. */
function Summary({ totals }: { totals: DebtTotal[] }) {
  return (
    <View style={styles.summary}>
      {totals.map((t) => (
        <View key={t.currency} style={styles.summaryRow}>
          {t.owed_to_me_minor ? (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Owed to you</Text>
              <Money minor={t.owed_to_me_minor} currency={t.currency} colored style={styles.summaryMoney} />
            </View>
          ) : null}
          {t.i_owe_minor ? (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>You owe</Text>
              <Money minor={-t.i_owe_minor} currency={t.currency} style={[styles.summaryMoney, { color: C.red }]} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function DebtRow({ d, first, today, settled }: { d: DebtWithAccount; first: boolean; today: string; settled?: boolean }) {
  const overdue = !settled && isOverdue(d, today);
  const due = d.due_date ? humanDayTime(d.due_date) : "No due date";
  const when = settled && d.settled_date ? `Paid back ${humanDayTime(d.settled_date)}` : overdue ? `Overdue · was due ${due}` : due;
  const subtitle = [when, d.accountName].filter(Boolean).join(" · ");
  return (
    <Row title={d.person} subtitle={subtitle} subtitleColor={overdue ? (C.red as unknown as string) : undefined}
      right={<Money minor={d.amount_minor} currency={d.currency} />}
      onPress={() => router.push({ pathname: "/debt/edit", params: { id: d.id } })}
      style={[!first && styles.divider, settled && styles.disabled]} />
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  disabled: { opacity: 0.45 },
  summary: { paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.sm, gap: S.sm },
  summaryRow: { flexDirection: "row", gap: S.xl },
  summaryItem: { gap: 1 },
  summaryMoney: { fontSize: 20, fontWeight: "700" },
  summaryLabel: { fontSize: 12, color: C.tertiary },
});
