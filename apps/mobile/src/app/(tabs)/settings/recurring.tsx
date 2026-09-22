import { useCallback, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { newPickKey, usePickResult } from "@/store/pick";
import { REMINDER_OPTIONS, WAIT_DAYS_OPTIONS, getRecurringWait, getRecurringWaitDays, getReminderDaysBefore, setRecurringWait, setRecurringWaitDays, setReminderDaysBefore, waitDefaultDays } from "@/lib/settings";
import { Stack, router } from "expo-router";
import { listRows, dueOccurrences, detectRecurring, adoptCandidate, ruleWaitDays, sumInBase, waitingOccurrences, yearlyAmountMinor, type RecurringCandidate, type RecurringRule } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { ensureNotificationPermission } from "@/lib/notifications";
import { AmountPill, Card, Chip, Empty, Row, ScreenNote, SectionHeader, StatPair, ToggleRow } from "@/components/ui";
import { BarButton, BottomBar } from "@/components/BottomBar";
import { C, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { getBaseCurrency, useRates } from "@/lib/rates";

type RuleRowData = RecurringRule & { account?: { name: string; currency: string }; category?: { name: string }; due: number; waitingSince: string | null; wait: number };

const dayCount = (d: number) => (d === 1 ? "1 day" : `${d} days`);

/** Where the amount and cadence come from, asked after the posting question. */
const SOURCE_CHOICE = [
  { value: "tx", label: "From a past transaction", subtitle: "Pick one you already logged — title, amount, category, tags and how often are filled in" },
  { value: "new", label: "Enter it myself", subtitle: "Amount and name, then the rest on the rule screen" },
];

/** The first question: it decides whether the rule ever asks you anything again. */
const POSTING_CHOICE = [
  { value: "auto", label: "Automatic", subtitle: "It leaves your account by itself — a subscription or standing order on a fixed day. Kopiyka adds it for you and tells you it did." },
  { value: "manual", label: "Manual", subtitle: "The day or the amount moves around, so Kopiyka asks first and you post it once it has actually gone out." },
];

/** The sheet is still dismissing when its answer arrives, so the next one waits for it to be gone. */
const then = (fn: () => void) => setTimeout(fn, 450);
const toEditor = (extra: Record<string, string>) => router.push({ pathname: "/recurring/[id]", params: { id: "new", ...extra } });

export default function RecurringList() {
  const rules = useQuery((db) => {
    const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
    const today = todayLocal();
    const waitDefault = waitDefaultDays();
    return (listRows(db, "recurring_rules", "deleted=0", [], "next_date") as RecurringRule[]).map((r): RuleRowData => ({
      ...r, account: accounts.get(r.account_id), category: r.category_id ? cats.get(r.category_id) : undefined, due: dueOccurrences(r, today).length,
      waitingSince: waitingOccurrences(r, today, waitDefault)[0] ?? null, wait: ruleWaitDays(r, waitDefault),
    }));
  });
  // A rule whose day has come while it waits for the bank is neither due nor idle, and it is the one
  // state a glance at this screen should explain: nothing is owed yet, the charge is simply not here.
  const expecting = rules.filter((r) => r.active && r.waitingSince);
  const due = rules.filter((r) => r.due > 0 && !r.auto_post && r.active && !r.waitingSince);
  const auto = rules.filter((r) => r.auto_post && r.active && !r.waitingSince);
  const manual = rules.filter((r) => !r.auto_post && r.active && r.due === 0 && !r.waitingSince);
  const paused = rules.filter((r) => !r.active);
  // What the active rules commit you to, every cadence normalised to a year and converted to the
  // base currency. Paused rules are excluded: they cost nothing until you switch them back on.
  const base = useQuery(() => getBaseCurrency());
  const perCurrency = useMemo(() => rules.filter((r) => r.active)
    .map((r) => ({ currency: r.account?.currency ?? base, minor: yearlyAmountMinor(r) })), [rules, base]);
  const { rateFor } = useRates([...new Set(perCurrency.map((y) => y.currency))], base);
  const yearly = sumInBase(perCurrency, base, rateFor);
  const suggestions = useQuery((db) => detectRecurring(db, { today: todayLocal() }));
  const remind = useQuery(() => getReminderDaysBefore());
  const wait = useQuery(() => getRecurringWait());
  const waitDays = useQuery(() => getRecurringWaitDays());
  const remindKey = useMemo(() => newPickKey("remind"), []);
  const waitKey = useMemo(() => newPickKey("wait"), []);
  usePickResult<string>(waitKey, useCallback((v: string) => setRecurringWaitDays(Number(v)), []));
  const pickWait = () => router.push({ pathname: "/pick/option", params: { key: waitKey, title: "Wait for the charge", selected: String(waitDays), options: JSON.stringify(WAIT_DAYS_OPTIONS.map((d) => ({ value: String(d), label: dayCount(d) }))) } });
  // Adding a rule: pick where it comes from, enter the amount, then the rule screen for the rest.
  const w = useMemo(() => ({ post: newPickKey("wpost"), src: newPickKey("wsrc"), tx: newPickKey("wtx"), amount: newPickKey("wamt"), name: newPickKey("wname") }), []);
  const newAmount = useRef(0);
  const newAuto = useRef(false);
  usePickResult<string>(remindKey, useCallback((v: string) => setReminderDaysBefore(Number(v)), []));
  const pickRemind = () => router.push({ pathname: "/pick/option", params: { key: remindKey, title: "Default reminder for new rules", selected: String(remind), options: JSON.stringify(REMINDER_OPTIONS) } });
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  usePickResult<string>(w.post, useCallback((v: string) => {
    newAuto.current = v === "auto";
    then(() => router.push({ pathname: "/pick/option", params: { key: w.src, title: "Where does it come from?", options: JSON.stringify(SOURCE_CHOICE) } }));
  }, [w.src]));
  usePickResult<string>(w.src, useCallback((v: string) => {
    then(() => v === "tx"
      ? router.push({ pathname: "/pick/transaction", params: { key: w.tx, title: "Which transaction repeats?" } })
      : router.push({ pathname: "/pick/amount", params: { key: w.amount, title: "How much?", currency: accounts[0]?.currency ?? "" } }));
  }, [w.tx, w.amount, accounts]));
  // A past transaction fills everything in; a fresh one carries the amount and the rest is set on the
  // rule screen, which already has a row for each of them.
  usePickResult<string>(w.tx, useCallback((id: string) => { then(() => toEditor({ tx: id, auto: newAuto.current ? "1" : "0" })); }, []));
  usePickResult<number>(w.amount, useCallback((minor: number) => {
    newAmount.current = minor;
    then(() => router.push({ pathname: "/pick/text", params: { key: w.name, title: "What is it called?" } }));
  }, [w.name]));
  usePickResult<string>(w.name, useCallback((v: string) => {
    then(() => toEditor({ amount: String(newAmount.current), name: v, auto: newAuto.current ? "1" : "0" }));
  }, []));
  const addRule = () => router.push({ pathname: "/pick/option", params: { key: w.post, title: "How does it get paid?", options: JSON.stringify(POSTING_CHOICE) } });

  const adopt = async (cs: RecurringCandidate[]) => {
    await ensureNotificationPermission();
    mutate((db) => { for (const c of cs) adoptCandidate(db, c); });
  };

  return (
    <>
      <Stack.Screen options={{ title: "Recurring" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        {perCurrency.length ? (
          <StatPair stats={[
            { label: "Per month", minor: Math.round(yearly.minor / 12), currency: base, color: yearly.minor < 0 ? C.red : C.green },
            { label: "Per year", minor: yearly.minor, currency: base, color: yearly.minor < 0 ? C.red : C.green },
          ]} />
        ) : null}
        {yearly.missing.length ? <Text style={styles.warn}>No rate yet for {yearly.missing.join(", ")} — those rules are not counted.</Text> : null}
        <Card style={{ marginTop: S.sm }}>
          <Row icon="bell" iconColor="#FF375F" title="Default reminder" subtitle={REMINDER_OPTIONS.find((o) => o.value === String(remind))?.label ?? `${remind} days before`} onPress={pickRemind} />
          <ToggleRow icon="hourglass" iconColor="#64D2FF" title="Wait for the charge" style={styles.divider}
            subtitle="Let the real payment arrive and settle the rule, instead of adding one on the day"
            value={wait} onChange={setRecurringWait} />
          {wait ? <Row icon="clock.badge.exclamationmark" iconColor="#FF9F0A" title="Wait up to" subtitle={dayCount(waitDays)} onPress={pickWait} style={styles.divider} /> : null}
        </Card>
        <ScreenNote>
          A rule for money that comes back: rent, subscriptions, salary.{" "}
          {wait
            ? "With waiting on, a rule keeps quiet on its day: the payment your bank notifies — or one you log yourself — is taken as that month's, with the rule's category and the amount actually charged. Only if nothing turns up within the window does the rule act: automatic ones post their own amount, manual ones ask. Individual rules can wait longer or less."
            : "An automatic rule posts itself on the day and tells you it did; a manual one waits and asks first, for a payment whose day or amount moves around. If the Shortcut automation already logs these payments, turn on waiting above so they are not added twice."}
          {" "}Kopiyka also spots repeats in what you have already logged and offers them below.
        </ScreenNote>
        {rules.length === 0 && suggestions.length === 0 ? <Empty title="No recurring transactions" hint="Tap Add to make one." /> : null}
        {expecting.length ? <SectionHeader>Waiting for the charge</SectionHeader> : null}
        {expecting.length ? <Card>{expecting.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {due.length ? <SectionHeader>Due now · confirm</SectionHeader> : null}
        {due.length ? <Card>{due.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} confirm />)}</Card> : null}
        {manual.length ? <SectionHeader>Manual · asks before posting</SectionHeader> : null}
        {manual.length ? <Card>{manual.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {auto.length ? <SectionHeader>Automatic</SectionHeader> : null}
        {auto.length ? <Card>{auto.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {paused.length ? <SectionHeader>Paused</SectionHeader> : null}
        {paused.length ? <Card>{paused.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {suggestions.length ? (
          <SectionHeader right={<Pressable onPress={() => void adopt(suggestions)} hitSlop={8}><Text style={styles.addAll}>Add all</Text></Pressable>}>Suggested from your history</SectionHeader>
        ) : null}
        {suggestions.length ? (
          <Card>
            {suggestions.map((c, i) => (
              <Row key={c.key} title={c.title ?? c.category_name ?? "Recurring"}
                subtitle={`${freqLabel(c.frequency, c.interval)} · next ${humanDayTime(c.next_date, c.time_of_day, todayLocal(), c.frequency === "yearly")} · ${c.source === "planned" ? "planned in Budget Flow → automatic" : `seen ${c.occurrences}× → manual`}`}
                right={<View style={styles.right}><AmountPill minor={c.amount_minor} currency={c.currency} /><Chip label="Add" onPress={() => void adopt([c])} /></View>}
                style={i > 0 ? styles.divider : undefined} />
            ))}
          </Card>
        ) : null}
        <Text style={styles.foot}>Totals cover active rules only, every cadence normalised to a year. Reminders are local notifications on this phone; {wait ? "a rule acts only once its window has closed without a charge." : "automatic rules post on the day, manual ones wait for your tap."}</Text>
      </ScrollView>
      <BottomBar><BarButton icon="plus" label="Add" onPress={addRule} a11y="Add a recurring rule" /></BottomBar>
    </>
  );
}

export function freqLabel(f: string, interval: number): string {
  if (interval > 1) return `every ${interval} ${f === "daily" ? "days" : f === "weekly" ? "weeks" : f === "monthly" ? "months" : "years"}`;
  return f === "daily" ? "daily" : f === "weekly" ? "weekly" : f === "monthly" ? "monthly" : "yearly";
}

function RuleRow({ r, first, confirm }: { r: RuleRowData; first: boolean; confirm?: boolean }) {
  const title = r.payee || r.category?.name || "Recurring";
  const sub = r.waitingSince
    ? `Expected ${humanDayTime(r.waitingSince)} · ${r.auto_post ? "posts" : "asks"} if nothing arrives within ${dayCount(r.wait)}`
    : `${freqLabel(r.frequency, r.interval)} · ${r.account?.name ?? ""}${r.category && r.payee ? ` · ${r.category.name}` : ""}`;
  return (
    <Row title={title}
      subtitle={sub}
      right={<View style={styles.right}><Text style={styles.when}>{humanDayTime(r.next_date, r.time_of_day, todayLocal(), r.frequency === "yearly")}</Text><AmountPill minor={r.amount_minor} currency={r.account?.currency ?? ""} /></View>}
      onPress={() => router.push(confirm ? { pathname: "/recurring/confirm", params: { id: r.id } } : { pathname: "/recurring/[id]", params: { id: r.id } })}
      style={[!first && styles.divider, !r.active && { opacity: 0.5 }]} />
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  foot: { color: C.tertiary, fontSize: 13, textAlign: "center", marginTop: S.xl, paddingHorizontal: S.xl },
  addAll: { color: C.tint, fontSize: 15, fontWeight: "600" },
  warn: { color: C.orange, fontSize: 12, paddingHorizontal: S.xl, paddingTop: 2 },
  right: { alignItems: "flex-end", gap: 4 },
  when: { fontSize: 13, color: C.secondary },
});
