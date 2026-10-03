import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { candidateFromTransaction, createRecurring, getRow, iconFor, jsonIds, listRows, remove, save, formatMinor, type Frequency, type RecurringRule } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { ConfirmBar } from "@/components/Keypad";
import { Card, DeleteRow, ModalHeader, Row, Segmented } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, localIso, timeLabel, todayLocal } from "@/lib/dates";
import { confirmDiscard, guardOptions, useDirty, useDiscardGuard } from "@/lib/discard";
import { CUSTOM, parseRepeat, repeatCountTitle, repeatCounts, repeatLabel, repeatOptions, repeatUnits, repeatValue } from "@/lib/repeat";
import { ensureNotificationPermission } from "@/lib/notifications";
import { reminderOptions, WAIT_DAYS_OPTIONS, getReminderDaysBefore, getRecurringWait, getRecurringWaitDays } from "@/lib/settings";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { catName, catNameById, acctName } from "@/lib/names";
import { t } from "@/i18n";

const posting = () => [
  { value: "auto", label: t("recurring.posting.auto"), subtitle: t("recurring.posting.autoSubtitle") },
  { value: "manual", label: t("recurring.posting.manual"), subtitle: t("recurring.posting.manualSubtitle") },
];

/** How long this one rule waits for the charge. "Default" is the window set in Settings → Recurring. */
const waitOptions = (fallback: number) => [
  { value: "default", label: t("recurring.wait.default", { days: dayCount(fallback) }), subtitle: t("recurring.wait.defaultSubtitle") },
  ...WAIT_DAYS_OPTIONS.map((d) => ({ value: String(d), label: dayCount(d) })),
];
function dayCount(d: number): string { return t("recurring.days", { count: d }); }

/** "Seen 4× · monthly" for a series read out of history, or the one-transaction guess. */
function seenLabel(c: { source: string; occurrences: number; frequency: Frequency }): string {
  return c.source === "history" && c.occurrences > 1 ? t("recurring.fromTx.seen", { count: c.occurrences, repeat: repeatLabel(c.frequency, 1).toLowerCase() }) : t("recurring.fromTx.guessed");
}

/** Push a single-choice sheet. Module level so the pick handlers can use it before `option` exists. */
function askOption(key: string, title: string, options: { value: string; label: string; subtitle?: string }[], selected?: string) {
  router.push({ pathname: "/pick/option", params: { key, title, options: JSON.stringify(options), ...(selected ? { selected } : {}) } });
}

/**
 * Recurring rule as a card modal: amount hero, then one row per setting (each opens a
 * picker), keypad and confirm pinned at the bottom. Nothing is squeezed into the title.
 */
export default function RecurringEdit() {
  const { id, auto, amount, repeat, remind, name, tx } = useLocalSearchParams<{ id: string; auto?: string; amount?: string; repeat?: string; remind?: string; name?: string; tx?: string }>();
  const insets = useSafeAreaInsets();
  const existing = id === "new" ? null : getRow(db, "recurring_rules", id) ?? null;
  // Chosen in the add wizard: everything the transaction can tell us, read once at mount.
  const [seedTx] = useState(() => (id === "new" && tx ? candidateFromTransaction(db, tx, todayLocal()) : null));
  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  const [accountId, setAccountId] = useState(existing?.account_id ?? seedTx?.account_id ?? accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? "EUR";
  const [kind, setKind] = useState<"expense" | "income">((existing ?? seedTx) && (existing ?? seedTx)!.amount_minor > 0 ? "income" : "expense");
  const [amountMinor, setAmountMinor] = useState<number>(Math.abs(existing ? existing.amount_minor : seedTx ? seedTx.amount_minor : Number(amount) || 0));
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? seedTx?.category_id ?? null);
  const [payee, setPayee] = useState(existing?.payee ?? seedTx?.title ?? catNameById(seedTx?.category_id, seedTx?.category_name ?? null) ?? name ?? "");
  // Copied onto every transaction this rule posts (`postOccurrence`), and what names the entry when
  // there is no title — the same fallback detection uses when it reads a series out of history.
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // "monthly/1" or "daily/5" from the wizard; a transaction brings its own detected cadence.
  const seeded = repeat ? parseRepeat(repeat) : null;
  const [freq, setFreq] = useState<Frequency>(existing?.frequency ?? seedTx?.frequency ?? seeded?.freq ?? "monthly");
  const [interval, setInterval_] = useState(existing?.interval ?? seedTx?.interval ?? seeded?.interval ?? 1);
  const [start, setStart] = useState(existing?.next_date ?? seedTx?.next_date ?? todayLocal());
  const [daysBefore, setDaysBefore] = useState<number | null>(existing ? (existing.notify ? existing.notify_days_before : null) : remind ? (remind === "off" ? null : Number(remind)) : getReminderDaysBefore());
  const [autoPost, setAutoPost] = useState(existing ? existing.auto_post === 1 : auto === "1");
  const [time, setTime] = useState(existing?.time_of_day ?? seedTx?.time_of_day ?? timeLabel(localIso()));
  // Only offered while waiting is switched on app-wide: with it off the row would set a number that
  // nothing reads. null follows the default window.
  const waiting = useQuery(() => getRecurringWait());
  const waitFallback = useQuery(() => getRecurringWaitDays());
  const [waitDays, setWaitDays] = useState<number | null>(existing?.wait_days ?? null);
  // The name the bank prints on this charge, which is rarely the name you gave the rule. Taken from
  // a payment you point at, so the rule recognises next month's even if the price has changed.
  const [matchPayee, setMatchPayee] = useState<string | null>(existing?.match_payee ?? seedTx?.match_payee ?? null);
  const [tagIds, setTagIds] = useState<string[]>(() => jsonIds((existing ?? seedTx)?.tag_ids ?? ""));
  const customUnit = useRef<Frequency>("monthly");
  const [fromTx, setFromTx] = useState<string | null>(seedTx ? seenLabel(seedTx) : null);
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([accountId, kind, amountMinor, categoryId, payee, notes, freq, interval, start, daysBefore, autoPost, time, waitDays, matchPayee, tagIds]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
  const cat = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) : null), [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((tg) => tagIds.includes(tg.id)), [tagIds.join(",")]);
  const keys = useMemo(() => ({ cat: newPickKey("rcat"), acc: newPickKey("racc"), date: newPickKey("rdate"), time: newPickKey("rtime"), payee: newPickKey("rpayee"), notes: newPickKey("rnotes"), amount: newPickKey("ramount"), repeat: newPickKey("rrep"), unit: newPickKey("runit"), count: newPickKey("rcount"), remind: newPickKey("rrem"), post: newPickKey("rpost"), wait: newPickKey("rwait"), match: newPickKey("rmatch"), tags: newPickKey("rtags"), tx: newPickKey("rtx") }), []);
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  usePickResult<string>(keys.tx, useCallback((id: string) => {
    const c = candidateFromTransaction(db, id, todayLocal());
    if (!c) return;
    setAccountId(c.account_id); setKind(c.amount_minor > 0 ? "income" : "expense");
    setAmountMinor(Math.abs(c.amount_minor));
    setCategoryId(c.category_id); setPayee(c.title ?? ""); setFreq(c.frequency); setInterval_(c.interval); setStart(c.next_date); setTime(c.time_of_day); setTagIds(jsonIds(c.tag_ids));
    setMatchPayee(c.match_payee);
    setFromTx(seenLabel(c));
  }, []));
  usePickResult<string>(keys.time, useCallback((v: string) => setTime(v), []));
  usePickResult<number>(keys.amount, useCallback((v: number) => setAmountMinor(Math.abs(v)), []));
  usePickResult<string>(keys.payee, useCallback((v: string) => setPayee(v), []));
  usePickResult<string>(keys.notes, useCallback((v: string) => setNotes(v), []));
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => setCategoryId(v), []));
  usePickResult<string>(keys.acc, useCallback((v: string) => setAccountId(v), []));
  usePickResult<string>(keys.date, useCallback((v: string) => setStart(v), []));
  usePickResult<string>(keys.repeat, useCallback((v: string) => {
    if (v === CUSTOM) { setTimeout(() => askOption(keys.unit, t("recurring.repeat.every.title"), repeatUnits()), 450); return; }
    const r = parseRepeat(v); if (r) { setFreq(r.freq); setInterval_(r.interval); }
  }, [keys.unit]));
  usePickResult<string>(keys.unit, useCallback((u: string) => {
    const unit = repeatUnits().find((x) => x.value === u); if (!unit) return;
    customUnit.current = unit.value;
    setTimeout(() => askOption(keys.count, repeatCountTitle(unit.value), repeatCounts(unit.value)), 450);
  }, [keys.count]));
  usePickResult<string>(keys.count, useCallback((n: string) => { setFreq(customUnit.current); setInterval_(Number(n) || 1); }, []));
  usePickResult<string>(keys.remind, useCallback((v: string) => setDaysBefore(v === "off" ? null : Number(v)), []));
  usePickResult<string>(keys.post, useCallback((v: string) => setAutoPost(v === "auto"), []));
  usePickResult<string>(keys.wait, useCallback((v: string) => setWaitDays(v === "default" ? null : Number(v)), []));
  usePickResult<string>(keys.match, useCallback((txId: string) => {
    const row = getRow(db, "transactions", txId);
    setMatchPayee(row?.payee?.trim() || null);
  }, []));
  const titled = !!payee.trim();
  const valid = amountMinor > 0 && !!account && titled;
  const editAmount = () => router.push({ pathname: "/pick/amount", params: { key: keys.amount, title: t("recurring.amount"), currency, value: String(amountMinor || "") } });

  const commit = async () => {
    if (!valid || !account) return;
    if (daysBefore !== null) await ensureNotificationPermission();
    mutate((d) => {
      const base = { account_id: account.id, amount_minor: amountMinor * (kind === "expense" ? -1 : 1), category_id: categoryId, payee: payee.trim() || null, notes: notes.trim() || null, tag_ids: JSON.stringify(tagIds), frequency: freq, interval, start_date: existing?.start_date ?? start, next_date: start, notify: daysBefore !== null ? 1 : 0, notify_days_before: daysBefore ?? 1, auto_post: autoPost ? 1 : 0, time_of_day: time, wait_days: waitDays, match_payee: matchPayee } as const;
      if (existing) save(d, "recurring_rules", { ...existing, ...base } as RecurringRule); else createRecurring(d, base);
    });
    leave();
  };
  // Picking a payment teaches the rule the shop's name as the bank writes it; clearing falls back to
  // matching on the exact amount alone.
  const pickMatch = () => router.push({ pathname: "/pick/transaction", params: { key: keys.match, title: t("recurring.match.pickTitle") } });
  const editMatch = () => {
    if (!matchPayee) { pickMatch(); return; }
    Alert.alert(t("recurring.match.title"), t("recurring.match.body", { name: matchPayee }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("recurring.match.amountOnly"), style: "destructive", onPress: () => setMatchPayee(null) },
      { text: t("recurring.match.another"), onPress: pickMatch },
    ]);
  };
  const del = () => existing && Alert.alert(t("recurring.delete.title"), t("recurring.delete.body"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => remove(d, "recurring_rules", existing.id)); leave(); } },
  ]);
  const option = (key: string, title: string, options: { value: string; label: string; subtitle?: string }[], selected?: string) => router.push({ pathname: "/pick/option", params: { key, title, options: JSON.stringify(options), ...(selected ? { selected } : {}) } });
  const repeats = repeatLabel(freq, interval);
  const remindLabel = daysBefore === null ? t("recurring.reminder.off") : reminderOptions().find((o) => o.value === String(daysBefore))?.label ?? t("recurring.reminder.daysBefore", { count: daysBefore });
  const catIcon = cat ? iconFor(cat.name, { icon: cat.icon, color: cat.color }) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      {existing ? null : <Stack.Screen options={guardOptions("recurring rule")} />}
      <ModalHeader title={existing ? t("recurring.title.edit") : t("recurring.title.new")} left={{ label: t("common.cancel"), onPress: () => (existing ? router.back() : confirmDiscard(leave)) }}
        right={existing ? { label: existing.active ? t("recurring.pause") : t("recurring.resume"), bold: false, onPress: () => { mutate((d) => save(d, "recurring_rules", { ...existing, active: existing.active ? 0 : 1 })); leave(); } } : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: S.md }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Pressable onPress={editAmount} style={styles.hero} accessibilityRole="button" accessibilityLabel={t("recurring.amountA11y", { amount: `${formatMinor(amountMinor, currency)} ${currency}` })} accessibilityHint={t("recurring.amountHint")}>
          <Text style={[styles.amount, kind === "income" && { color: C.green }, !amountMinor && { color: C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{kind === "expense" ? "−" : "+"}{formatMinor(amountMinor, currency)} <Text style={styles.cur}>{currency}</Text></Text>
          <Text style={styles.summary}>{amountMinor ? t("recurring.summary", { repeat: repeats.toLowerCase(), next: humanDayTime(start, time) }) : t("recurring.tapAmount")}</Text>
        </Pressable>
        <View style={{ paddingHorizontal: S.md, marginBottom: S.md }}><Segmented value={kind} onChange={setKind} options={[{ value: "expense", label: t("recurring.expense") }, { value: "income", label: t("recurring.income"), color: C.green as unknown as string }]} /></View>
        {!existing ? (
          <Card style={{ marginBottom: S.md }}>
            <Row icon="clock.arrow.circlepath" title={t("recurring.fromTx.title")} subtitle={fromTx ?? t("recurring.fromTx.subtitle")} onPress={() => router.push({ pathname: "/pick/transaction", params: { key: keys.tx, title: t("recurring.fromTx.pickTitle") } })} />
          </Card>
        ) : null}
        <Card>
          <Row icon="textformat" iconColor="#8E8E93" title={t("recurring.titleRow")} subtitle={payee || t("recurring.titleRequired")} subtitleColor={titled ? undefined : C.orange} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.payee, title: t("recurring.titleRow"), value: payee } })} />
          <Row icon="text.alignleft" iconColor="#8E8E93" title={t("recurring.note")} subtitle={notes || t("recurring.noteHint")} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.notes, title: t("recurring.note"), value: notes } })} style={styles.divider} />
          <Row icon={(catIcon?.icon as SFSymbol) ?? "folder"} iconColor={catIcon?.color ?? "#FF9F0A"} title={t("recurring.category")} subtitle={cat ? catName(cat) : t("common.none")} onPress={() => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind, selected: categoryId ?? "" } })} style={styles.divider} />
          <Row icon="creditcard" title={t("recurring.account")} subtitle={acctName(account) ?? t("recurring.choose")} onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.acc, selected: accountId } })} style={styles.divider} />
          <Row icon="number" iconColor="#5E5CE6" title={t("recurring.tags")} subtitle={tags.length ? tags.map((tg) => `#${tg.name}`).join(" ") : t("common.none")} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } })} style={styles.divider} />
        </Card>
        <Card style={{ marginTop: S.md }}>
          <Row icon="repeat" iconColor="#30D158" title={t("recurring.repeats")} subtitle={repeats} onPress={() => option(keys.repeat, t("recurring.repeats"), repeatOptions(), repeatValue(freq, interval))} />
          <Row icon="calendar" iconColor="#FF9F0A" title={t("recurring.next")} subtitle={humanDayTime(start)} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: start } })} style={styles.divider} />
          <Row icon="clock" iconColor="#5E5CE6" title={t("recurring.time")} subtitle={time} onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: time } })} style={styles.divider} />
          <Row icon="bell" iconColor="#FF375F" title={t("recurring.reminder.title")} subtitle={remindLabel} onPress={() => option(keys.remind, t("recurring.reminder.title"), [{ value: "off", label: t("recurring.reminder.off") }, ...reminderOptions()], daysBefore === null ? "off" : String(daysBefore))} style={styles.divider} />
          <Row icon="bolt" iconColor="#FFD60A" title={t("recurring.posting.title")} subtitle={autoPost ? (waiting ? t("recurring.posting.autoLate") : t("recurring.posting.autoDay")) : waiting ? t("recurring.posting.askLate") : t("recurring.posting.askFirst")} onPress={() => option(keys.post, t("recurring.posting.title"), posting(), autoPost ? "auto" : "manual")} style={styles.divider} />
          {waiting ? (
            <Row icon="doc.text.magnifyingglass" iconColor="#0A84FF" title={t("recurring.match.row")}
              subtitle={matchPayee ?? t("recurring.match.amountHint")}
              onPress={editMatch} style={styles.divider} />
          ) : null}
          {waiting ? (
            <Row icon="hourglass" iconColor="#64D2FF" title={t("recurring.wait.title")}
              subtitle={waitDays === null ? t("recurring.wait.default", { days: dayCount(waitFallback) }) : dayCount(waitDays)}
              onPress={() => option(keys.wait, t("recurring.wait.title"), waitOptions(waitFallback), waitDays === null ? "default" : String(waitDays))} style={styles.divider} />
          ) : null}
        </Card>
        {existing ? <View style={{ marginTop: S.md }}><DeleteRow label={t("recurring.delete.row")} onPress={del} /></View> : null}
      </ScrollView>
      <View style={{ paddingTop: S.sm, paddingBottom: Math.max(insets.bottom, S.md), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }}>
        <ConfirmBar amount={`${kind === "expense" ? "−" : "+"}${formatMinor(amountMinor, currency)} ${currency}`} label={!amountMinor ? t("recurring.confirm.amount") : !titled ? t("recurring.confirm.title") : existing ? t("recurring.confirm.save") : t("recurring.confirm.add")} onPress={() => void commit()} disabled={!valid} color={kind === "income" ? (C.green as unknown as string) : undefined} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingHorizontal: S.xl, paddingTop: S.sm, paddingBottom: S.md, gap: 2 },
  amount: { fontSize: 44, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  cur: { fontSize: 18, color: C.secondary, fontWeight: "600" },
  summary: { fontSize: 14, color: C.secondary },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
});
