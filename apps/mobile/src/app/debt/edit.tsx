import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { createDebt, getRow, remove, save, settleDebt, toMinor, fromMinor, trimNumber, DEFAULT_DEBT_NOTIFY_TIME, type Debt, type DebtDirection } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, ChipRow, DeleteRow, Segmented, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, localIso, todayLocal } from "@/lib/dates";
import { getBaseCurrency } from "@/lib/rates";

const DIRECTIONS: { value: DebtDirection; label: string }[] = [
  { value: "owed_to_me", label: "They owe me" },
  { value: "i_owe", label: "I owe" },
];

/**
 * Debt as a card modal, modelled on account/edit: keypad hero at the top, chips for the
 * rest. The amount is always a magnitude — direction carries the sign, so the ± key (which
 * every Keypad shows) would be meaningless on the number itself; instead it flips direction,
 * the same physical gesture doing the job the Segmented control does with a tap.
 */
export default function DebtEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = id === "new" ? null : getRow(db, "debts", id) ?? null;
  const [person, setPerson] = useState(existing?.person ?? "");
  const [direction, setDirection] = useState<DebtDirection>(existing?.direction ?? "owed_to_me");
  const [currency, setCurrency] = useState(existing?.currency ?? getBaseCurrency());
  const [expr, setExpr] = useState(existing ? trimNumber(fromMinor(existing.amount_minor, existing.currency)) : "");
  const [accountId, setAccountId] = useState<string | null>(existing?.account_id ?? null);
  const [dueDate, setDueDate] = useState<string | null>(existing?.due_date ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [notify, setNotify] = useState(existing ? existing.notify === 1 : true);
  const [notifyTime, setNotifyTime] = useState(existing?.notify_time || DEFAULT_DEBT_NOTIFY_TIME);
  const account = useQuery((d) => (accountId ? getRow(d, "accounts", accountId) : null), [accountId]);
  const keys = useMemo(() => ({ person: newPickKey("dperson"), currency: newPickKey("dcur"), account: newPickKey("dacc"), date: newPickKey("ddate"), time: newPickKey("dtime"), notes: newPickKey("dnotes") }), []);
  // The state setters are already stable, so they are handed over as they are; wrapping them in
  // useCallback only gives the React Compiler a memo it cannot reconcile with what it infers.
  usePickResult<string>(keys.person, setPerson);
  usePickResult<string>(keys.currency, setCurrency);
  usePickResult<string>(keys.account, setAccountId);
  // A due date is what a reminder is made of, so setting the first one turns the reminder on:
  // `notify` is stored as 0 while there is no date, and a debt that only just got one would
  // otherwise be saved silent.
  usePickResult<string>(keys.date, (v: string) => { setDueDate(v); if (!dueDate) setNotify(true); });
  usePickResult<string>(keys.time, setNotifyTime);
  usePickResult<string>(keys.notes, setNotes);

  const value = evalExpr(expr);
  const amountMinor = toMinor(value ?? 0, currency);
  const valid = person.trim().length > 0 && amountMinor > 0;
  const shown = `${expr || "0"} ${currency}`;
  const heroTitle = person || (direction === "owed_to_me" ? "Money lent" : "Money borrowed");
  const summary = `${direction === "owed_to_me" ? "Owes you" : "You owe"} · ${dueDate ? `due ${humanDayTime(dueDate)}${notify ? ` · reminder at ${notifyTime}` : ""}` : "no due date"}`;

  const commit = () => {
    if (!valid) return;
    mutate((d) => {
      const base = { person: person.trim(), direction, amount_minor: amountMinor, currency, account_id: accountId, due_date: dueDate, notes: notes.trim() || null, notify: dueDate && notify ? 1 : 0, notify_time: notifyTime } as const;
      if (existing) save(d, "debts", { ...existing, ...base } as Debt);
      else createDebt(d, { ...base, opened_date: todayLocal() });
    });
    router.back();
  };

  const markPaid = () => {
    if (!existing) return;
    // The settling transaction gets the wall-clock time, not core's midday default: a balance only
    // counts transactions dated at or before now, so a payment recorded at breakfast would otherwise
    // read as planned and stay out of the account until noon.
    const settle = (writeTransaction: boolean) => { mutate((d) => settleDebt(d, existing.id, { day: todayLocal(), dateIso: localIso(), writeTransaction })); router.back(); };
    if (existing.account_id) {
      Alert.alert("Mark as paid back?", "You can also record the transaction that moves the money.", [
        { text: "Cancel", style: "cancel" },
        { text: "Just mark it paid", onPress: () => settle(false) },
        { text: "Record the payment too", onPress: () => settle(true) },
      ]);
    } else settle(false);
  };
  // Reopening a debt whose settlement wrote a transaction leaves both standing, which counts the
  // money twice — so say what is still there and let the user delete it themselves afterwards.
  const reopen = () => {
    if (!existing) return;
    const go = () => { mutate((d) => save(d, "debts", { ...existing, settled_date: null } as Debt)); router.back(); };
    if (!existing.transaction_id) { go(); return; }
    Alert.alert("Reopen this debt?", "The transaction recorded when it was paid back stays in the account. Delete it there if the money never moved.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reopen", onPress: go },
    ]);
  };
  const del = () => existing && Alert.alert("Delete debt?", "This cannot be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => remove(d, "debts", existing.id)); router.back(); } },
  ]);

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>{heroTitle}</Title>
          <Text style={[styles.amount, direction === "owed_to_me" ? { color: C.green } : { color: C.red }]} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Amount ${shown}`}>{shown}</Text>
          <Subtle>{summary}</Subtle>
        </View>
      }
      bottom={
        <>
          <View style={{ paddingHorizontal: S.md }}><Segmented value={direction} onChange={setDirection} options={DIRECTIONS} /></View>
          <ChipRow>
            <Chip icon="person" label={person || "Who?"} active={!!person} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.person, title: "Who?", value: person } })} />
            <Chip icon="coloncurrencysign.circle" label={currency} active onPress={() => router.push({ pathname: "/pick/currency", params: { key: keys.currency, selected: currency } })} />
            <Chip icon="calendar" label={dueDate ? humanDayTime(dueDate) : "No due date"} active={!!dueDate} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: dueDate ?? todayLocal() } })} />
            {dueDate ? <Chip icon="xmark.circle" compact label="Clear date" onPress={() => setDueDate(null)} /> : null}
          </ChipRow>
          <ChipRow>
            <Chip icon="creditcard" label={account?.name ?? "Account (optional)"} active={!!account} onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.account, selected: accountId ?? "" } })} />
            {account ? <Chip icon="xmark.circle" compact label="No account" onPress={() => setAccountId(null)} /> : null}
            <Chip icon="note.text" label={notes || "Notes"} active={!!notes} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.notes, title: "Notes", value: notes, multiline: "1" } })} />
            {dueDate ? <Chip icon={notify ? "bell.fill" : "bell.slash"} label={notify ? "Reminder on" : "Reminder off"} active={notify} onPress={() => setNotify((v) => !v)} /> : null}
            {dueDate && notify ? <Chip icon="clock" label={notifyTime} active onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: notifyTime } })} /> : null}
          </ChipRow>
          <Keypad value={expr} onChange={setExpr} onToggleSign={() => setDirection((d) => (d === "owed_to_me" ? "i_owe" : "owed_to_me"))} />
          <ConfirmBar amount={shown} label={valid ? (existing ? "Tap to save" : "Tap to add") : person.trim() ? "Enter an amount" : "Who owes what?"} onPress={commit} disabled={!valid} color={direction === "owed_to_me" ? (C.green as unknown as string) : undefined} />
          {existing && !existing.settled_date ? <DeleteRow icon="checkmark.circle" label="Mark as paid back" onPress={markPaid} /> : null}
          {existing?.settled_date ? (
            <>
              <Subtle style={{ textAlign: "center" }}>Paid back {humanDayTime(existing.settled_date)}</Subtle>
              <DeleteRow icon="arrow.uturn.backward" label="Reopen" onPress={reopen} />
            </>
          ) : null}
          {existing ? <DeleteRow label="Delete debt" onPress={del} /> : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: 4 },
  amount: { fontSize: 34, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
});
