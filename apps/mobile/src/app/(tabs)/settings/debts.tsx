import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { Stack, router } from "expo-router";
import { debtPaid, debtTotals, formatMinor, groupName, groupPeople, isOverdue, listDebts, listPeople, listRows, peopleGroups, personBalances, type Debt, type DebtTotal, type Person, type PersonBalance } from "@kopiyka/core";
import { PersonAvatar } from "@/components/PersonAvatar";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Collapsible } from "@/components/Collapsible";
import { Card, Empty, Money, Row, ScreenNote, SectionHeader, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { t } from "@/i18n";
import { acctName } from "@/lib/names";

type DebtWithAccount = Debt & { accountName?: string; paid: number };
type Friend = Person & { balances: PersonBalance[] };
/** A line in Friends: one friend, or friends kept together (a couple, flatmates) under one name. */
type Entry = { kind: "one"; friend: Friend } | { kind: "group"; id: string; members: Friend[]; balances: { currency: string; owed_minor: number }[] };

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
  // Groups first-class in the list: each sits where its first member would, and owes what its
  // members owe added up, per currency (core/people.ts peopleGroups — a group of one is no group).
  const entries = useMemo((): Entry[] => {
    const groups = peopleGroups(data.friends);
    const seen = new Set<string>();
    const out: Entry[] = [];
    for (const f of data.friends) {
      const members = f.group_id ? groups.get(f.group_id) as Friend[] | undefined : undefined;
      if (!members) { out.push({ kind: "one", friend: f }); continue; }
      if (seen.has(f.group_id!)) continue;
      seen.add(f.group_id!);
      const per = new Map<string, number>();
      for (const m of members) for (const b of m.balances) per.set(b.currency, (per.get(b.currency) ?? 0) + b.owed_minor);
      out.push({ kind: "group", id: f.group_id!, members, balances: [...per].filter(([, v]) => v).map(([currency, owed_minor]) => ({ currency, owed_minor })) });
    }
    return out;
  }, [data.friends]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // One picker answers both: a new group (no id), or the group being changed (its id is kept, and
  // whoever is no longer ticked leaves it; fewer than two dissolves it).
  const pickKey = useMemo(() => newPickKey("group"), []);
  const editing = useRef<string | undefined>(undefined);
  usePickResult<string[]>(pickKey, useCallback((ids: string[]) => {
    const g = editing.current;
    const id = mutate((db) => groupPeople(db, ids, g));
    if (id) setOpen((s) => new Set(s).add(id));
  }, []));
  const pickGroup = (group?: { id: string; members: Friend[] }) => {
    editing.current = group?.id;
    router.push({ pathname: "/pick/people", params: { key: pickKey, selected: group ? group.members.map((m) => m.id).join(",") : "" } });
  };
  const today = todayLocal();
  const owedToMe = data.debts.filter((d) => !d.settled_date && d.direction === "owed_to_me");
  const iOwe = data.debts.filter((d) => !d.settled_date && d.direction === "i_owe");
  const settled = data.debts.filter((d) => d.settled_date);

  return (
    <>
      <Stack.Screen options={{ title: t("settingsLists.debts.title"), headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        <ScreenNote more={t("settingsLists.debts.introMore")}>{t("settingsLists.debts.introShort")}</ScreenNote>
        {data.friends.length ? (
          <SectionHeader right={data.friends.length > 1
            ? <Tap onPress={() => pickGroup()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("people.group.makeA11y")}><Text style={styles.link}>{t("people.group.make")}</Text></Tap>
            : undefined}>{t("people.list.title")}</SectionHeader>
        ) : null}
        {entries.length ? (
          <Card>
            {entries.map((e, i) => e.kind === "one" ? (
              <FriendRow key={e.friend.id} p={e.friend} style={i ? styles.divider : undefined} />
            ) : (
              <View key={e.id} style={i ? styles.divider : undefined}>
                <Row title={groupName(e.members.map((m) => m.name), t("people.group.and"))} left={<Avatars people={e.members} />}
                  subtitle={balanceLine(e.balances, true)}
                  right={<SymbolView name={open.has(e.id) ? "chevron.down" : "chevron.right"} size={12} tintColor={C.tertiary} />}
                  onPress={() => toggle(e.id)} />
                <Collapsible open={open.has(e.id)} lazy>
                  <View style={styles.members}>
                    {e.members.map((m) => <FriendRow key={m.id} p={m} style={styles.divider} />)}
                    <Tap onPress={() => pickGroup(e)} style={[styles.editGroup, styles.divider]} accessibilityRole="button">
                      <SymbolView name="person.2.badge.gearshape" size={16} tintColor={C.tint} />
                      <Text style={styles.link}>{t("people.group.edit")}</Text>
                    </Tap>
                  </View>
                </Collapsible>
              </View>
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

/** What a friend (or a group) owes, per currency, never added across them. */
function balanceLine(balances: { currency: string; owed_minor: number }[], group?: boolean): string {
  if (!balances.length) return t("people.list.even");
  return balances.map((b) => {
    const amount = `${formatMinor(Math.abs(b.owed_minor), b.currency)} ${b.currency}`;
    return group ? t(b.owed_minor > 0 ? "people.group.owe" : "people.group.owed", { amount }) : t(b.owed_minor > 0 ? "people.list.owes" : "people.list.owed", { amount });
  }).join(" · ");
}

function FriendRow({ p, style }: { p: Friend; style?: object }) {
  return (
    <Row title={p.name} left={<PersonAvatar person={p} />} style={style} subtitle={balanceLine(p.balances)}
      onPress={() => router.push({ pathname: "/person/[id]", params: { id: p.id } })} />
  );
}

/** A group's members as overlapping tiles, in the space one avatar takes, so names line up with single friends'. */
function Avatars({ people }: { people: Person[] }) {
  const shown = people.slice(0, 2);
  return (
    <View style={styles.stack}>
      {shown.map((p, i) => <View key={p.id} style={[styles.stackItem, i ? styles.stackBack : styles.stackFront]}><PersonAvatar person={p} size={22} /></View>)}
    </View>
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
  link: { color: C.tint, fontSize: 15, fontWeight: "600" },
  members: { backgroundColor: C.bgGrouped, paddingLeft: S.lg },
  editGroup: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 44, paddingHorizontal: S.lg },
  stack: { width: 30, height: 30 },
  stackItem: { position: "absolute", borderRadius: 12, borderWidth: 1.5, borderColor: C.card },
  stackFront: { left: -2, top: -2, zIndex: 1 },
  stackBack: { right: -2, bottom: -2 },
  summary: { paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.sm, gap: S.sm },
  summaryRow: { flexDirection: "row", gap: S.xl },
  summaryItem: { gap: 1 },
  summaryMoney: { fontSize: 20, fontWeight: "700" },
  summaryLabel: { fontSize: 12, color: C.tertiary },
}));
