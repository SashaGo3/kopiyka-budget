import { StyleSheet } from "react-native";
import { router } from "expo-router";
import { debtTotals, formatMinor, listDebts, listPeople, personBalances, toSplitQueue } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Money, Row, SectionHeader } from "@/components/ui";
import { PersonAvatar } from "@/components/PersonAvatar";
import { C, themed } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Money that is yours but not in your accounts yet (core/people.ts, debts.ts): every friend who owes
 * you — or whom you owe — with their balance, what the open debts add up to, and the payments
 * waiting to be split. None of it is spending, so it sits under the budgets rather than among them,
 * and it is not drawn at all when there is nothing to say.
 */
export function OwedCard() {
  const data = useQuery((db) => {
    const people = new Map(listPeople(db, { archived: true }).map((p) => [p.id, p]));
    const balances = personBalances(db).filter((b) => people.has(b.person_id))
      .sort((a, b) => b.owed_minor - a.owed_minor);
    const debts = debtTotals(listDebts(db, { settled: false })).filter((d) => d.owed_to_me_minor || d.i_owe_minor);
    return { people, balances, debts, toSplit: toSplitQueue(db).length };
  });
  if (!data.balances.length && !data.debts.length && !data.toSplit) return null;
  let n = 0;
  const divider = () => (n++ ? styles.divider : undefined);
  const rows = [
    ...data.balances.map((b) => {
      const p = data.people.get(b.person_id)!;
      const amount = `${formatMinor(Math.abs(b.owed_minor), b.currency)} ${b.currency}`;
      return (
        <Row key={`${b.person_id}|${b.currency}`} title={p.name} left={<PersonAvatar person={p} />}
          subtitle={b.owed_minor > 0 ? t("people.list.owes", { amount }) : t("people.list.owed", { amount })}
          right={<Money minor={Math.abs(b.owed_minor)} currency={b.currency} style={b.owed_minor < 0 ? { color: C.red } : undefined} />}
          onPress={() => router.push({ pathname: "/person/[id]", params: { id: b.person_id } })} style={divider()} />
      );
    }),
    ...(data.debts.length ? [
      <Row key="debts" icon="arrow.left.arrow.right.circle" iconColor="#FF9500" title={t("people.card.debts")}
        subtitle={data.debts.map((d) => [d.owed_to_me_minor ? `+${formatMinor(d.owed_to_me_minor, d.currency)} ${d.currency}` : null, d.i_owe_minor ? `−${formatMinor(d.i_owe_minor, d.currency)} ${d.currency}` : null].filter(Boolean).join(" · ")).join(", ")}
        onPress={() => router.push("/settings/debts")} style={divider()} />,
    ] : []),
    ...(data.toSplit ? [
      <Row key="split" icon="square.split.2x1" title={t("people.card.toSplit", { count: data.toSplit })} onPress={() => router.push("/tosplit")} style={divider()} />,
    ] : []),
  ];
  return (
    <>
      <SectionHeader>{t("people.card.title")}</SectionHeader>
      <Card>{rows}</Card>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
