import { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { createDebt, getRow, remove, save, settleDebt, toMinor, fromMinor, trimNumber, DEFAULT_DEBT_NOTIFY_TIME, type Debt, type DebtDirection } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, ChipRow, DeleteRow, Segmented, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, localIso, todayLocal } from "@/lib/dates";
import { getBaseCurrency } from "@/lib/rates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";
import { acctName } from "@/lib/names";

const directions = (): { value: DebtDirection; label: string }[] => [
  { value: "owed_to_me", label: t("debt.direction.owedToMe") },
  { value: "i_owe", label: t("debt.direction.iOwe") },
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
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([person, direction, currency, expr, accountId, dueDate, notes, notify, notifyTime]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
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
  const heroTitle = person || (direction === "owed_to_me" ? t("debt.lent") : t("debt.borrowed"));
  const summary = [
    direction === "owed_to_me" ? t("debt.summary.owesYou") : t("debt.summary.youOwe"),
    dueDate ? t("debt.summary.due", { date: humanDayTime(dueDate) }) : t("debt.summary.noDue"),
    ...(dueDate && notify ? [t("debt.summary.reminder", { time: notifyTime })] : []),
  ].join(" · ");

  const commit = () => {
    if (!valid) return;
    mutate((d) => {
      const base = { person: person.trim(), direction, amount_minor: amountMinor, currency, account_id: accountId, due_date: dueDate, notes: notes.trim() || null, notify: dueDate && notify ? 1 : 0, notify_time: notifyTime } as const;
      if (existing) save(d, "debts", { ...existing, ...base } as Debt);
      else createDebt(d, { ...base, opened_date: todayLocal() });
    });
    leave();
  };

  const markPaid = () => {
    if (!existing) return;
    // The settling transaction gets the wall-clock time, not core's midday default: a balance only
    // counts transactions dated at or before now, so a payment recorded at breakfast would otherwise
    // read as planned and stay out of the account until noon.
    const settle = (writeTransaction: boolean) => { mutate((d) => settleDebt(d, existing.id, { day: todayLocal(), dateIso: localIso(), writeTransaction })); leave(); };
    if (existing.account_id) {
      Alert.alert(t("debt.paid.title"), t("debt.paid.body"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("debt.paid.only"), onPress: () => settle(false) },
        { text: t("debt.paid.record"), onPress: () => settle(true) },
      ]);
    } else settle(false);
  };
  // Reopening a debt whose settlement wrote a transaction leaves both standing, which counts the
  // money twice — so say what is still there and let the user delete it themselves afterwards.
  const reopen = () => {
    if (!existing) return;
    const go = () => { mutate((d) => save(d, "debts", { ...existing, settled_date: null } as Debt)); leave(); };
    if (!existing.transaction_id) { go(); return; }
    Alert.alert(t("debt.reopen.title"), t("debt.reopen.body"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("debt.reopen.confirm"), onPress: go },
    ]);
  };
  const del = () => existing && Alert.alert(t("debt.delete.title"), t("debt.delete.body"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => remove(d, "debts", existing.id)); leave(); } },
  ]);

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>{heroTitle}</Title>
          <Text style={[styles.amount, direction === "owed_to_me" ? { color: C.green } : { color: C.red }]} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={t("debt.amountA11y", { amount: shown })}>{shown}</Text>
          <Subtle>{summary}</Subtle>
        </View>
      }
      bottom={
        <>
          <View style={{ paddingHorizontal: S.md }}><Segmented value={direction} onChange={setDirection} options={directions()} /></View>
          <ChipRow>
            <Chip icon="person" label={person || t("debt.who")} active={!!person} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.person, title: t("debt.who"), value: person } })} />
            <Chip icon="coloncurrencysign.circle" label={currency} active onPress={() => router.push({ pathname: "/pick/currency", params: { key: keys.currency, selected: currency } })} />
            <Chip icon="calendar" label={dueDate ? humanDayTime(dueDate) : t("debt.noDueDate")} active={!!dueDate} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: dueDate ?? todayLocal() } })} />
            {dueDate ? <Chip icon="xmark.circle" compact label={t("debt.clearDate")} onPress={() => setDueDate(null)} /> : null}
          </ChipRow>
          <ChipRow>
            <Chip icon="creditcard" label={acctName(account) ?? t("debt.account")} active={!!account} onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.account, selected: accountId ?? "" } })} />
            {account ? <Chip icon="xmark.circle" compact label={t("debt.noAccount")} onPress={() => setAccountId(null)} /> : null}
            <Chip icon="note.text" label={notes || t("debt.notes")} active={!!notes} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.notes, title: t("debt.notes"), value: notes, multiline: "1" } })} />
            {dueDate ? <Chip icon={notify ? "bell.fill" : "bell.slash"} label={notify ? t("debt.reminderOn") : t("debt.reminderOff")} active={notify} onPress={() => setNotify((v) => !v)} /> : null}
            {dueDate && notify ? <Chip icon="clock" label={notifyTime} active onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: notifyTime } })} /> : null}
          </ChipRow>
          <Keypad value={expr} onChange={setExpr} onToggleSign={() => setDirection((d) => (d === "owed_to_me" ? "i_owe" : "owed_to_me"))} />
          <ConfirmBar amount={shown} label={valid ? (existing ? t("debt.confirm.save") : t("debt.confirm.add")) : person.trim() ? t("debt.confirm.amount") : t("debt.confirm.who")} onPress={commit} disabled={!valid} color={direction === "owed_to_me" ? (C.green as unknown as string) : undefined} />
          {existing && !existing.settled_date ? <DeleteRow icon="checkmark.circle" label={t("debt.paid.row")} onPress={markPaid} /> : null}
          {existing?.settled_date ? (
            <>
              <Subtle style={{ textAlign: "center" }}>{t("debt.paidBack", { date: humanDayTime(existing.settled_date) })}</Subtle>
              <DeleteRow icon="arrow.uturn.backward" label={t("debt.reopen.confirm")} onPress={reopen} />
            </>
          ) : null}
          {existing ? <DeleteRow label={t("debt.delete.row")} onPress={del} /> : null}
        </>
      }
    />
  );
}

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: 4 },
  amount: { fontSize: 34, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
}));
