import { Stack, router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { activeBudgets, budgetRows, formatMinor, getRow, listRows, save, sumInBase, type Budget } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { Card, ModalHeader, StatPair, ToggleRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { budgetTitle, nameMaps } from "@/lib/budgetName";
import { getBudgetScope } from "@/lib/settings";
import { scopeAccount, scopeAccountIds } from "@/lib/scope";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { todayLocal } from "@/lib/dates";
import { currentPeriod } from "@/lib/period";
import { t } from "@/i18n";

/**
 * What the Planned number is made of, and a switch per budget.
 *
 * Reached by tapping Planned, because that is where the question is asked — "why is this bigger
 * than I expected?" — and the answer and the fix belong in the same place. Switching a budget off
 * leaves it on the Budgets screen with its own bar and its own spending; it only stops counting
 * towards Planned and Available (and towards free money, which is the same number spread over the
 * days to salary). Each toggle writes immediately: there is nothing here to get wrong and no
 * reason to make it a two-step.
 */
export default function BudgetPlanned() {
  const period = currentPeriod();
  const base = useQuery(() => getBaseCurrency());
  const scope = useQuery(() => getBudgetScope());
  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  const rows = useQuery((d) => {
    const names = nameMaps(d);
    const spent = new Map(budgetRows(d, { start: period.start, end: period.end, accountIds: scopeAccountIds(scope, accounts), budgetAccount: scopeAccount(scope) }).map((r) => [r.budget.id, r.spent_minor]));
    return activeBudgets(d, todayLocal(), scopeAccount(scope)).map((b) => ({ b, title: budgetTitle(b, names), spent: spent.get(b.id) ?? 0 }));
  }, [scope, accounts.length, period.start]);

  const counted = rows.filter((r) => r.b.in_planned !== 0);
  const { rateFor } = useRates([...new Set(rows.map((r) => r.b.currency))], base);
  const planned = sumInBase(counted.map((r) => ({ currency: r.b.currency, minor: r.b.amount_minor })), base, rateFor);
  const available = sumInBase(counted.map((r) => ({ currency: r.b.currency, minor: r.b.amount_minor - r.spent })), base, rateFor);

  const toggle = (b: Budget, on: boolean) => mutate((d) => {
    const row = getRow(d, "budgets", b.id);
    if (row) save(d, "budgets", { ...row, in_planned: on ? 1 : 0 } as Budget);
  });

  const section = (list: typeof rows, on: boolean) => (
    <Card>
      {list.map((r, i) => (
        <ToggleRow key={r.b.id} title={r.title} value={on} onChange={(v) => toggle(r.b, v)} style={i > 0 ? styles.divider : undefined}
          subtitle={on ? t("budgets.planned.rowLeft", { amount: `${formatMinor(r.b.amount_minor, r.b.currency)} ${r.b.currency}`, left: formatMinor(r.b.amount_minor - r.spent, r.b.currency) }) : `${formatMinor(r.b.amount_minor, r.b.currency)} ${r.b.currency}`} />
      ))}
    </Card>
  );

  const off = rows.filter((r) => r.b.in_planned === 0);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ModalHeader title={t("budgets.planned.title")} left={{ label: t("common.done"), onPress: () => router.back() }} />
      <ScrollView contentContainerStyle={{ paddingBottom: S.xl }}>
        <StatPair stats={[
          { label: t("budgets.planned.title"), minor: planned.minor, currency: base, color: C.green },
          { label: t("budgets.available"), minor: available.minor, currency: base, color: available.minor < 0 ? C.red : undefined },
        ]} />
        <Text style={styles.intro}>
          {off.length ? t("budgets.planned.countedOff", { count: counted.length, off: off.length }) : t("budgets.planned.counted", { count: counted.length })} {t("budgets.planned.intro")}
        </Text>
        {counted.length ? <Text style={styles.sh}>{t("budgets.planned.countedHeader")}</Text> : null}
        {counted.length ? section(counted, true) : null}
        {off.length ? <Text style={styles.sh}>{t("budgets.planned.notCountedHeader")}</Text> : null}
        {off.length ? section(off, false) : null}
        {rows.length === 0 ? <Text style={styles.intro}>{t("budgets.planned.empty")}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { color: C.secondary, fontSize: 14, lineHeight: 20, paddingHorizontal: S.xl, paddingTop: S.sm, paddingBottom: S.md },
  sh: { color: C.secondary, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
});
