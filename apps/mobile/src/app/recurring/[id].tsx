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
import { confirmDiscard, guardOptions } from "@/lib/discard";
import { CUSTOM, REPEAT_OPTIONS, REPEAT_UNITS, parseRepeat, repeatCounts, repeatLabel, repeatValue } from "@/lib/repeat";
import { ensureNotificationPermission } from "@/lib/notifications";
import { REMINDER_OPTIONS, WAIT_DAYS_OPTIONS, getReminderDaysBefore, getRecurringWait, getRecurringWaitDays } from "@/lib/settings";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const POSTING = [{ value: "auto", label: "Automatic", subtitle: "Leaves your account by itself; added on the day" }, { value: "manual", label: "Manual", subtitle: "Day or amount varies; Kopiyka asks first" }];

/** How long this one rule waits for the charge. "Default" is the window set in Settings → Recurring. */
const waitOptions = (fallback: number) => [
  { value: "default", label: `Default · ${dayCount(fallback)}`, subtitle: "Follows Settings → Recurring" },
  ...WAIT_DAYS_OPTIONS.map((d) => ({ value: String(d), label: dayCount(d) })),
];
function dayCount(d: number): string { return d === 1 ? "1 day" : `${d} days`; }

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
  const [payee, setPayee] = useState(existing?.payee ?? seedTx?.title ?? seedTx?.category_name ?? name ?? "");
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
  const [fromTx, setFromTx] = useState<string | null>(seedTx ? (seedTx.source === "history" && seedTx.occurrences > 1 ? `Seen ${seedTx.occurrences}× · ${seedTx.frequency}` : "Monthly guessed from one transaction") : null);
  const cat = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) : null), [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((t) => tagIds.includes(t.id)), [tagIds.join(",")]);
  const keys = useMemo(() => ({ cat: newPickKey("rcat"), acc: newPickKey("racc"), date: newPickKey("rdate"), time: newPickKey("rtime"), payee: newPickKey("rpayee"), notes: newPickKey("rnotes"), amount: newPickKey("ramount"), repeat: newPickKey("rrep"), unit: newPickKey("runit"), count: newPickKey("rcount"), remind: newPickKey("rrem"), post: newPickKey("rpost"), wait: newPickKey("rwait"), match: newPickKey("rmatch"), tags: newPickKey("rtags"), tx: newPickKey("rtx") }), []);
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  usePickResult<string>(keys.tx, useCallback((id: string) => {
    const c = candidateFromTransaction(db, id, todayLocal());
    if (!c) return;
    setAccountId(c.account_id); setKind(c.amount_minor > 0 ? "income" : "expense");
    setAmountMinor(Math.abs(c.amount_minor));
    setCategoryId(c.category_id); setPayee(c.title ?? ""); setFreq(c.frequency); setInterval_(c.interval); setStart(c.next_date); setTime(c.time_of_day); setTagIds(jsonIds(c.tag_ids));
    setMatchPayee(c.match_payee);
    setFromTx(c.source === "history" && c.occurrences > 1 ? `Seen ${c.occurrences}× · ${c.frequency}` : "Monthly guessed from one transaction");
  }, []));
  usePickResult<string>(keys.time, useCallback((v: string) => setTime(v), []));
  usePickResult<number>(keys.amount, useCallback((v: number) => setAmountMinor(Math.abs(v)), []));
  usePickResult<string>(keys.payee, useCallback((v: string) => setPayee(v), []));
  usePickResult<string>(keys.notes, useCallback((v: string) => setNotes(v), []));
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => setCategoryId(v), []));
  usePickResult<string>(keys.acc, useCallback((v: string) => setAccountId(v), []));
  usePickResult<string>(keys.date, useCallback((v: string) => setStart(v), []));
  usePickResult<string>(keys.repeat, useCallback((v: string) => {
    if (v === CUSTOM) { setTimeout(() => askOption(keys.unit, "Repeat every", REPEAT_UNITS.map((u) => ({ value: u.value, label: u.label }))), 450); return; }
    const r = parseRepeat(v); if (r) { setFreq(r.freq); setInterval_(r.interval); }
  }, [keys.unit]));
  usePickResult<string>(keys.unit, useCallback((u: string) => {
    const unit = REPEAT_UNITS.find((x) => x.value === u); if (!unit) return;
    customUnit.current = unit.value;
    setTimeout(() => askOption(keys.count, `How many ${unit.plural}?`, repeatCounts(unit.value)), 450);
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
  const editAmount = () => router.push({ pathname: "/pick/amount", params: { key: keys.amount, title: "Amount", currency, value: String(amountMinor || "") } });

  const commit = async () => {
    if (!valid || !account) return;
    if (daysBefore !== null) await ensureNotificationPermission();
    mutate((d) => {
      const base = { account_id: account.id, amount_minor: amountMinor * (kind === "expense" ? -1 : 1), category_id: categoryId, payee: payee.trim() || null, notes: notes.trim() || null, tag_ids: JSON.stringify(tagIds), frequency: freq, interval, start_date: existing?.start_date ?? start, next_date: start, notify: daysBefore !== null ? 1 : 0, notify_days_before: daysBefore ?? 1, auto_post: autoPost ? 1 : 0, time_of_day: time, wait_days: waitDays, match_payee: matchPayee } as const;
      if (existing) save(d, "recurring_rules", { ...existing, ...base } as RecurringRule); else createRecurring(d, base);
    });
    router.back();
  };
  // Picking a payment teaches the rule the shop's name as the bank writes it; clearing falls back to
  // matching on the exact amount alone.
  const pickMatch = () => router.push({ pathname: "/pick/transaction", params: { key: keys.match, title: "Which payment is this?" } });
  const editMatch = () => {
    if (!matchPayee) { pickMatch(); return; }
    Alert.alert("Recognise this charge", `Matched by "${matchPayee}", whatever it costs.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Match the amount only", style: "destructive", onPress: () => setMatchPayee(null) },
      { text: "Pick another payment", onPress: pickMatch },
    ]);
  };
  const del = () => existing && Alert.alert("Delete recurring rule?", "Already posted transactions stay.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => remove(d, "recurring_rules", existing.id)); router.back(); } },
  ]);
  const option = (key: string, title: string, options: { value: string; label: string; subtitle?: string }[], selected?: string) => router.push({ pathname: "/pick/option", params: { key, title, options: JSON.stringify(options), ...(selected ? { selected } : {}) } });
  const repeats = repeatLabel(freq, interval);
  const remindLabel = daysBefore === null ? "Off" : REMINDER_OPTIONS.find((o) => o.value === String(daysBefore))?.label ?? `${daysBefore} days before`;
  const catIcon = cat ? iconFor(cat.name, { icon: cat.icon, color: cat.color }) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      {existing ? null : <Stack.Screen options={guardOptions("recurring rule")} />}
      <ModalHeader title={existing ? "Recurring" : "New recurring"} left={{ label: "Cancel", onPress: () => (existing ? router.back() : confirmDiscard("recurring rule", () => router.back())) }}
        right={existing ? { label: existing.active ? "Pause" : "Resume", bold: false, onPress: () => { mutate((d) => save(d, "recurring_rules", { ...existing, active: existing.active ? 0 : 1 })); router.back(); } } : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: S.md }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Pressable onPress={editAmount} style={styles.hero} accessibilityRole="button" accessibilityLabel={`Amount: ${formatMinor(amountMinor, currency)} ${currency}`} accessibilityHint="Opens the keypad">
          <Text style={[styles.amount, kind === "income" && { color: C.green }, !amountMinor && { color: C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{kind === "expense" ? "−" : "+"}{formatMinor(amountMinor, currency)} <Text style={styles.cur}>{currency}</Text></Text>
          <Text style={styles.summary}>{amountMinor ? `${repeats.toLowerCase()} · next ${humanDayTime(start, time)}` : "Tap to enter the amount"}</Text>
        </Pressable>
        <View style={{ paddingHorizontal: S.md, marginBottom: S.md }}><Segmented value={kind} onChange={setKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income", color: C.green as unknown as string }]} /></View>
        {!existing ? (
          <Card style={{ marginBottom: S.md }}>
            <Row icon="clock.arrow.circlepath" title="Start from a transaction" subtitle={fromTx ?? "Search your history; amount, category, tags and period are filled in"} onPress={() => router.push({ pathname: "/pick/transaction", params: { key: keys.tx, title: "Which transaction repeats?" } })} />
          </Card>
        ) : null}
        <Card>
          <Row icon="textformat" iconColor="#8E8E93" title="Title" subtitle={payee || "Required — e.g. Netflix, Rent"} subtitleColor={titled ? undefined : C.orange} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.payee, title: "Title", value: payee } })} />
          <Row icon="text.alignleft" iconColor="#8E8E93" title="Note" subtitle={notes || "Added to every transaction this rule posts"} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.notes, title: "Note", value: notes } })} style={styles.divider} />
          <Row icon={(catIcon?.icon as SFSymbol) ?? "folder"} iconColor={catIcon?.color ?? "#FF9F0A"} title="Category" subtitle={cat?.name ?? "None"} onPress={() => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind, selected: categoryId ?? "" } })} style={styles.divider} />
          <Row icon="creditcard" title="Account" subtitle={account?.name ?? "Choose"} onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.acc, selected: accountId } })} style={styles.divider} />
          <Row icon="number" iconColor="#5E5CE6" title="Tags" subtitle={tags.length ? tags.map((t) => `#${t.name}`).join(" ") : "None"} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } })} style={styles.divider} />
        </Card>
        <Card style={{ marginTop: S.md }}>
          <Row icon="repeat" iconColor="#30D158" title="Repeats" subtitle={repeats} onPress={() => option(keys.repeat, "Repeats", REPEAT_OPTIONS, repeatValue(freq, interval))} />
          <Row icon="calendar" iconColor="#FF9F0A" title="Next" subtitle={humanDayTime(start)} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: start } })} style={styles.divider} />
          <Row icon="clock" iconColor="#5E5CE6" title="Time" subtitle={time} onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: time } })} style={styles.divider} />
          <Row icon="bell" iconColor="#FF375F" title="Reminder" subtitle={remindLabel} onPress={() => option(keys.remind, "Reminder", [{ value: "off", label: "Off" }, ...REMINDER_OPTIONS], daysBefore === null ? "off" : String(daysBefore))} style={styles.divider} />
          <Row icon="bolt" iconColor="#FFD60A" title="Posting" subtitle={autoPost ? (waiting ? "Automatically, once the charge is late" : "Automatically on the day") : waiting ? "Asks once the charge is late" : "Ask me first"} onPress={() => option(keys.post, "Posting", POSTING, autoPost ? "auto" : "manual")} style={styles.divider} />
          {waiting ? (
            <Row icon="doc.text.magnifyingglass" iconColor="#0A84FF" title="Recognise by"
              subtitle={matchPayee ?? "The exact amount — pick a payment to match its name too"}
              onPress={editMatch} style={styles.divider} />
          ) : null}
          {waiting ? (
            <Row icon="hourglass" iconColor="#64D2FF" title="Wait for the charge"
              subtitle={waitDays === null ? `Default · ${dayCount(waitFallback)}` : dayCount(waitDays)}
              onPress={() => option(keys.wait, "Wait for the charge", waitOptions(waitFallback), waitDays === null ? "default" : String(waitDays))} style={styles.divider} />
          ) : null}
        </Card>
        {existing ? <View style={{ marginTop: S.md }}><DeleteRow label="Delete rule" onPress={del} /></View> : null}
      </ScrollView>
      <View style={{ paddingTop: S.sm, paddingBottom: Math.max(insets.bottom, S.md), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }}>
        <ConfirmBar amount={`${kind === "expense" ? "−" : "+"}${formatMinor(amountMinor, currency)} ${currency}`} label={!amountMinor ? "Enter an amount" : !titled ? "Add a title" : existing ? "Tap to save" : "Tap to add rule"} onPress={() => void commit()} disabled={!valid} color={kind === "income" ? (C.green as unknown as string) : undefined} />
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
