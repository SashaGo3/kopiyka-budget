import { useCallback, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { newPickKey, usePickResult } from "@/store/pick";
import { WAIT_DAYS_OPTIONS, reminderLabel, reminderOptions, getRecurringWait, getRecurringWaitDays, getReminderDaysBefore, setRecurringWait, setRecurringWaitDays, setReminderDaysBefore, waitDefaultDays } from "@/lib/settings";
import { Stack, router } from "expo-router";
import { listRows, dueOccurrences, detectRecurring, adoptCandidate, ruleWaitDays, sumInBase, waitingOccurrences, yearlyAmountMinor, type RecurringCandidate, type RecurringRule } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { ensureNotificationPermission } from "@/lib/notifications";
import { AmountPill, Card, Chip, Empty, Footnote, Row, ScreenNote, SectionHeader, StatPair, ToggleRow } from "@/components/ui";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { catName, catNameById, acctName } from "@/lib/names";
import { t } from "@/i18n";

type RuleRowData = RecurringRule & { account?: { name: string; currency: string }; category?: { name: string; preset?: string | null }; due: number; waitingSince: string | null; wait: number };

const dayCount = (count: number) => t("settingsLists.recurring.days", { count });

/** Where the amount and cadence come from, asked after the posting question. */
const sourceChoice = () => [
  { value: "tx", label: t("settingsLists.recurring.source.tx"), subtitle: t("settingsLists.recurring.source.txSubtitle") },
  { value: "new", label: t("settingsLists.recurring.source.new"), subtitle: t("settingsLists.recurring.source.newSubtitle") },
];

/** The first question: it decides whether the rule ever asks you anything again. */
const postingChoice = () => [
  { value: "auto", label: t("settingsLists.recurring.posting.auto"), subtitle: t("settingsLists.recurring.posting.autoSubtitle") },
  { value: "manual", label: t("settingsLists.recurring.posting.manual"), subtitle: t("settingsLists.recurring.posting.manualSubtitle") },
];

/** The sheet is still dismissing when its answer arrives, so the next one waits for it to be gone. */
const then = (fn: () => void) => setTimeout(fn, 450);
const toEditor = (extra: Record<string, string>) => router.push({ pathname: "/recurring/[id]", params: { id: "new", ...extra } });

export default function RecurringList() {
  // The Add bar slides away while scrolling down, as on Transactions, and comes back on the way up.
  const { visible, onScroll } = useScrollHide();
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
  const pickWait = () => router.push({ pathname: "/pick/option", params: { key: waitKey, title: t("settingsLists.recurring.wait"), selected: String(waitDays), options: JSON.stringify(WAIT_DAYS_OPTIONS.map((d) => ({ value: String(d), label: dayCount(d) }))) } });
  // Adding a rule: pick where it comes from, enter the amount, then the rule screen for the rest.
  const w = useMemo(() => ({ post: newPickKey("wpost"), src: newPickKey("wsrc"), tx: newPickKey("wtx"), amount: newPickKey("wamt"), name: newPickKey("wname") }), []);
  const newAmount = useRef(0);
  const newAuto = useRef(false);
  usePickResult<string>(remindKey, useCallback((v: string) => setReminderDaysBefore(Number(v)), []));
  const pickRemind = () => router.push({ pathname: "/pick/option", params: { key: remindKey, title: t("settingsLists.recurring.defaultReminderTitle"), selected: String(remind), options: JSON.stringify(reminderOptions()) } });
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  usePickResult<string>(w.post, useCallback((v: string) => {
    newAuto.current = v === "auto";
    then(() => router.push({ pathname: "/pick/option", params: { key: w.src, title: t("settingsLists.recurring.source.title"), options: JSON.stringify(sourceChoice()) } }));
  }, [w.src]));
  usePickResult<string>(w.src, useCallback((v: string) => {
    then(() => v === "tx"
      ? router.push({ pathname: "/pick/transaction", params: { key: w.tx, title: t("settingsLists.recurring.whichTx") } })
      : router.push({ pathname: "/pick/amount", params: { key: w.amount, title: t("settingsLists.recurring.howMuch"), currency: accounts[0]?.currency ?? "" } }));
  }, [w.tx, w.amount, accounts]));
  // A past transaction fills everything in; a fresh one carries the amount and the rest is set on the
  // rule screen, which already has a row for each of them.
  usePickResult<string>(w.tx, useCallback((id: string) => { then(() => toEditor({ tx: id, auto: newAuto.current ? "1" : "0" })); }, []));
  usePickResult<number>(w.amount, useCallback((minor: number) => {
    newAmount.current = minor;
    then(() => router.push({ pathname: "/pick/text", params: { key: w.name, title: t("settingsLists.recurring.name") } }));
  }, [w.name]));
  usePickResult<string>(w.name, useCallback((v: string) => {
    then(() => toEditor({ amount: String(newAmount.current), name: v, auto: newAuto.current ? "1" : "0" }));
  }, []));
  const addRule = () => router.push({ pathname: "/pick/option", params: { key: w.post, title: t("settingsLists.recurring.posting.title"), options: JSON.stringify(postingChoice()) } });

  const adopt = async (cs: RecurringCandidate[]) => {
    await ensureNotificationPermission();
    mutate((db) => { for (const c of cs) adoptCandidate(db, c); });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("settingsLists.recurring.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }} onScroll={onScroll} scrollEventThrottle={16}>
        {perCurrency.length ? (
          <StatPair stats={[
            { label: t("settingsLists.recurring.perMonth"), minor: Math.round(yearly.minor / 12), currency: base, color: yearly.minor < 0 ? C.red : C.green },
            { label: t("settingsLists.recurring.perYear"), minor: yearly.minor, currency: base, color: yearly.minor < 0 ? C.red : C.green },
          ]} />
        ) : null}
        {yearly.missing.length ? <Text style={styles.warn}>{t("settingsLists.recurring.noRate", { currencies: yearly.missing.join(", ") })}</Text> : null}
        <Card style={{ marginTop: S.sm }}>
          <Row icon="bell" iconColor="#FF375F" title={t("settingsLists.recurring.defaultReminder")} subtitle={reminderLabel(remind)} onPress={pickRemind} />
          <ToggleRow icon="hourglass" iconColor="#64D2FF" title={t("settingsLists.recurring.wait")} style={styles.divider}
            subtitle={t("settingsLists.recurring.waitSubtitle")}
            value={wait} onChange={setRecurringWait} />
          {wait ? <Row icon="clock.badge.exclamationmark" iconColor="#FF9F0A" title={t("settingsLists.recurring.waitUpTo")} subtitle={dayCount(waitDays)} onPress={pickWait} style={styles.divider} /> : null}
        </Card>
        <ScreenNote more={wait ? t("settingsLists.recurring.noteMoreWait") : t("settingsLists.recurring.noteMoreNoWait")}>{t("settingsLists.recurring.noteShort")}</ScreenNote>
        {rules.length === 0 && suggestions.length === 0 ? <Empty title={t("settingsLists.recurring.emptyTitle")} hint={t("settingsLists.recurring.emptyHint")} /> : null}
        {expecting.length ? <SectionHeader>{t("settingsLists.recurring.expecting")}</SectionHeader> : null}
        {expecting.length ? <Card>{expecting.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {due.length ? <SectionHeader>{t("settingsLists.recurring.due")}</SectionHeader> : null}
        {due.length ? <Card>{due.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} confirm />)}</Card> : null}
        {manual.length ? <SectionHeader>{t("settingsLists.recurring.manual")}</SectionHeader> : null}
        {manual.length ? <Card>{manual.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {auto.length ? <SectionHeader>{t("settingsLists.recurring.auto")}</SectionHeader> : null}
        {auto.length ? <Card>{auto.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {paused.length ? <SectionHeader>{t("settingsLists.recurring.paused")}</SectionHeader> : null}
        {paused.length ? <Card>{paused.map((r, i) => <RuleRow key={r.id} r={r} first={i === 0} />)}</Card> : null}
        {suggestions.length ? (
          <SectionHeader right={<Pressable onPress={() => void adopt(suggestions)} hitSlop={8}><Text style={styles.addAll}>{t("settingsLists.recurring.addAll")}</Text></Pressable>}>{t("settingsLists.recurring.suggested")}</SectionHeader>
        ) : null}
        {suggestions.length ? (
          <Card>
            {suggestions.map((c, i) => (
              <Row key={c.key} title={c.title ?? catNameById(c.category_id, c.category_name) ?? t("settingsLists.recurring.fallbackTitle")}
                subtitle={c.source === "planned"
                  ? t("settingsLists.recurring.suggestionPlanned", { freq: freqLabel(c.frequency, c.interval), date: humanDayTime(c.next_date, c.time_of_day, todayLocal(), c.frequency === "yearly") })
                  : t("settingsLists.recurring.suggestionSeen", { freq: freqLabel(c.frequency, c.interval), date: humanDayTime(c.next_date, c.time_of_day, todayLocal(), c.frequency === "yearly"), count: c.occurrences })}
                right={<View style={styles.right}><AmountPill minor={c.amount_minor} currency={c.currency} /><Chip label={t("settingsLists.recurring.add")} onPress={() => void adopt([c])} /></View>}
                style={i > 0 ? styles.divider : undefined} />
            ))}
          </Card>
        ) : null}
        <Footnote style={styles.foot} more={wait ? t("settingsLists.recurring.footMoreWait") : t("settingsLists.recurring.footMoreNoWait")}>{t("settingsLists.recurring.footShort")}</Footnote>
      </ScrollView>
      <BottomBar visible={visible}><BarButton icon="plus" label={t("settingsLists.recurring.add")} onPress={addRule} a11y={t("settingsLists.recurring.addA11y")} /></BottomBar>
    </>
  );
}

/** "monthly", "every 2 weeks" — how often a rule repeats, in words. */
export function freqLabel(f: string, interval: number): string {
  const count = Math.max(1, interval);
  return f === "daily" ? t("settingsLists.recurring.freq.daily", { count })
    : f === "weekly" ? t("settingsLists.recurring.freq.weekly", { count })
    : f === "monthly" ? t("settingsLists.recurring.freq.monthly", { count })
    : t("settingsLists.recurring.freq.yearly", { count });
}

function RuleRow({ r, first, confirm }: { r: RuleRowData; first: boolean; confirm?: boolean }) {
  const category = r.category ? catName(r.category) : null;
  const title = r.payee || category || t("settingsLists.recurring.fallbackTitle");
  const expected = { date: r.waitingSince ? humanDayTime(r.waitingSince) : "", days: dayCount(r.wait) };
  const sub = r.waitingSince
    ? (r.auto_post ? t("settingsLists.recurring.expectedPosts", expected) : t("settingsLists.recurring.expectedAsks", expected))
    : `${freqLabel(r.frequency, r.interval)} · ${acctName(r.account) ?? ""}${category && r.payee ? ` · ${category}` : ""}`;
  return (
    <Row title={title}
      subtitle={sub}
      right={<View style={styles.right}><Text style={styles.when}>{humanDayTime(r.next_date, r.time_of_day, todayLocal(), r.frequency === "yearly")}</Text><AmountPill minor={r.amount_minor} currency={r.account?.currency ?? ""} /></View>}
      onPress={() => router.push(confirm ? { pathname: "/recurring/confirm", params: { id: r.id } } : { pathname: "/recurring/[id]", params: { id: r.id } })}
      style={[!first && styles.divider, !r.active && { opacity: 0.5 }]} />
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  foot: { marginTop: S.xl },
  addAll: { color: C.tint, fontSize: 15, fontWeight: "600" },
  warn: { color: C.orange, fontSize: 12, paddingHorizontal: S.xl, paddingTop: 2 },
  right: { alignItems: "flex-end", gap: 4 },
  when: { fontSize: 13, color: C.secondary },
}));
