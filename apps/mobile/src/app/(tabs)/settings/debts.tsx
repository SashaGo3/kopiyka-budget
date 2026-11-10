import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { Stack, router } from "expo-router";
import { debtPaid, debtTotals, formatMinor, isOverdue, listDebts, listPeople, listRows, personBalances, type Debt, type DebtTotal } from "@kopiyka/core";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useQuery } from "@/store";
import { Card, Empty, Money, Row, ScreenNote, SectionHeader } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { t } from "@/i18n";
import { acctName } from "@/lib/names";

type DebtWithAccount = Debt & { accountName?: string; paid: number };

export default function DebtsSettings() {
  // Add sits at the bottom like on Categories, and slides away while scrolling down.
  const { visible, onScroll } = useScrollHide();
  const data = useQuery((db) => {
    const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, acctName(a)]));
    const debts = listDebts(db).map((d): DebtWithAccount => ({ ...d, accountName: d.account_id ? accounts.get(d.account_id) : undefined, paid: debtPaid(db, d) }));
    // Friends you split with, the ones with something open first (core/people.ts).
    const balances = personBalances(db);
    const friends = listPeople(db).map((p) => ({ ...p, balances: balances.filter((b) => b.person_id === p.id) }))
      .sort((a, b) => Number(b.balances.length > 0) - Number(a.balances.length > 0));
    return { debts, totals: debtTotals(debts), friends };
  });
  const today = todayLocal();
  const owedToMe = data.debts.filter((d) => !d.settled_date && d.direction === "owed_to_me");
  const iOwe = data.debts.filter((d) => !d.settled_date && d.direction === "i_owe");
  const settled = data.debts.filter((d) => d.settled_date);

  return (
    <>
      <Stack.Screen options={{ title: t("settingsLists.debts.title"), headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={t("settingsLists.debts.introMore")}>{t("settingsLists.debts.introShort")}</ScreenNote>
        {data.friends.length ? <SectionHeader>{t("people.list.title")}</SectionHeader> : null}
        {data.friends.length ? (
          <Card>
            {data.friends.map((p, i) => (
              <Row key={p.id} title={p.name} left={<PersonAvatar person={p} />} style={i ? styles.divider : undefined}
                subtitle={p.balances.length ? p.balances.map((b) => t(b.owed_minor > 0 ? "people.list.owes" : "people.list.owed", { amount: `${formatMinor(Math.abs(b.owed_minor), b.currency)} ${b.currency}` })).join(" · ") : t("people.list.even")}
                onPress={() => router.push({ pathname: "/person/[id]", params: { id: p.id } })} />
            ))}
          </Card>
        ) : null}
        {data.totals.length ? <Summary totals={data.totals} /> : <Empty title={t("settingsLists.debts.emptyTitle")} hint={t("settingsLists.debts.emptyHint")} />}
        {owedToMe.length ? <SectionHeader>{t("settingsLists.debts.owedToYou")}</SectionHeader> : null}
        {owedToMe.length ? <Card>{owedToMe.map((d, i) => <DebtRow key={d.id} d={d} first={i === 0} today={today} />)}</Card> : null}
        {iOwe.length ? <SectionHeader>{t("settingsLists.debts.youOwe")}</SectionHeader> : null}
        {iOwe.length ? <Card>{iOwe.map((d, i) => <DebtRow key={d.id} d={d} first={i === 0} today={today} />)}</Card> : null}
        {settled.length ? <SectionHeader>{t("settingsLists.debts.settled")}</SectionHeader> : null}
        {settled.length ? <Card>{settled.map((d, i) => <DebtRow key={d.id} d={d} first={i === 0} today={today} settled />)}</Card> : null}
      </ScrollView>
      <BottomBar visible={visible}><BarButton icon="plus" label={t("settingsLists.debts.add")} onPress={() => router.push({ pathname: "/debt/edit", params: { id: "new" } })} a11y={t("settingsLists.debts.addA11y")} /></BottomBar>
    </>
  );
}

/** Per-currency, never added together: what is owed to the user and what the user owes. */
function Summary({ totals }: { totals: DebtTotal[] }) {
  return (
    <View style={styles.summary}>
      {totals.map((tot) => (
        <View key={tot.currency} style={styles.summaryRow}>
          {tot.owed_to_me_minor ? (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t("settingsLists.debts.owedToYou")}</Text>
              <Money minor={tot.owed_to_me_minor} currency={tot.currency} colored style={styles.summaryMoney} />
            </View>
          ) : null}
          {tot.i_owe_minor ? (
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t("settingsLists.debts.youOwe")}</Text>
              <Money minor={-tot.i_owe_minor} currency={tot.currency} style={[styles.summaryMoney, { color: C.red }]} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function DebtRow({ d, first, today, settled }: { d: DebtWithAccount; first: boolean; today: string; settled?: boolean }) {
  const overdue = !settled && isOverdue(d, today);
  const due = d.due_date ? humanDayTime(d.due_date) : t("settingsLists.debts.noDue");
  const when = settled && d.settled_date ? t("settingsLists.debts.paidBack", { date: humanDayTime(d.settled_date) }) : overdue ? t("settingsLists.debts.overdue", { date: due }) : due;
  const subtitle = [when, !settled && d.paid > 0 ? t("settingsLists.debts.paidPart", { amount: formatMinor(d.paid, d.currency) }) : null, d.accountName].filter(Boolean).join(" · ");
  return (
    <Row title={d.person} subtitle={subtitle} subtitleColor={overdue ? (C.red as unknown as string) : undefined}
      right={<Money minor={d.amount_minor} currency={d.currency} />}
      onPress={() => router.push({ pathname: "/debt/edit", params: { id: d.id } })}
      style={[!first && styles.divider, settled && styles.disabled]} />
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  disabled: { opacity: 0.45 },
  summary: { paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.sm, gap: S.sm },
  summaryRow: { flexDirection: "row", gap: S.xl },
  summaryItem: { gap: 1 },
  summaryMoney: { fontSize: 20, fontWeight: "700" },
  summaryLabel: { fontSize: 12, color: C.tertiary },
}));
