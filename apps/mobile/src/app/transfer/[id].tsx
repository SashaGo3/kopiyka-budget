import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, createTransfer, formatMinor, getRow, jsonIds, listRows, remove, toMinor, fromMinor, rateOrFallback } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, SheetFrame, Subtle, ChipRow, DeleteRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { dayLabel, dayWithNow, localIso, todayLocal } from "@/lib/dates";
import { getCurrentAccount } from "@/lib/settings";

/**
 * Transfer between two accounts. When currencies differ, the destination amount
 * is prefilled from Frankfurter (cached) and can be overridden on the keypad.
 */
export default function TransferSheet() {
  const p = useLocalSearchParams<{ id: string; from?: string; to?: string; amount?: string; stacked?: string }>();
  /** Opened on top of the entry sheet: Back returns there, saving closes both. */
  const stacked = p.stacked === "1";
  const isNew = p.id === "new";
  const legs = useMemo(() => (isNew ? [] : listRows(db, "transactions", "deleted=0 AND transfer_id=?", [p.id])), [isNew, p.id]);
  const outLeg = legs.find((l) => l.amount_minor < 0), inLeg = legs.find((l) => l.amount_minor >= 0);

  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  // Prefilled, but never silently: both cards name the account they picked and open the picker.
  // "From" starts at the account you are actually using — the one the rest of the app is scoped to —
  // rather than whichever happens to sort first.
  const firstFrom = outLeg?.account_id ?? p.from ?? (accounts.some((a) => a.id === getCurrentAccount()) ? getCurrentAccount() : accounts[0]?.id) ?? "";
  const [fromId, setFromId] = useState(firstFrom);
  const [toId, setToId] = useState(inLeg?.account_id ?? p.to ?? accounts.find((a) => a.id !== firstFrom)?.id ?? "");
  const from = accounts.find((a) => a.id === fromId), to = accounts.find((a) => a.id === toId);
  const cross = !!from && !!to && from.currency !== to.currency;

  /**
   * What each account holds without this transfer, so the arrow reads "before → after" even while
   * editing a transfer that is already in the database — its legs are in those balances already
   * (the same correction the entry sheet makes for the row it is editing).
   */
  const balances = useQuery((d) => ({
    from: fromId ? accountBalanceMinor(d, fromId) - legs.filter((l) => l.account_id === fromId).reduce((a, l) => a + l.amount_minor, 0) : 0,
    to: toId ? accountBalanceMinor(d, toId) - legs.filter((l) => l.account_id === toId).reduce((a, l) => a + l.amount_minor, 0) : 0,
  }), [fromId, toId, legs.length]);

  const [side, setSide] = useState<"from" | "to">("from");
  const [fromExpr, setFromExpr] = useState(outLeg && from ? String(fromMinor(-outLeg.amount_minor, from.currency)) : p.amount ?? "");
  const [toExpr, setToExpr] = useState(inLeg && to ? String(fromMinor(inLeg.amount_minor, to.currency)) : "");
  const [rate, setRate] = useState<{ rate: number; stale: boolean } | null>(null);
  const [date, setDate] = useState(outLeg?.date ?? localIso());
  const [note, setNote] = useState(outLeg?.notes ?? "");
  // Transfers can be categorised and tagged like any entry (e.g. "Savings", #vacation); both legs share them.
  const [categoryId, setCategoryId] = useState<string | null>(outLeg?.category_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(() => jsonIds(outLeg?.tag_ids ?? "[]"));
  const category = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) ?? null : null), [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((t) => tagIds.includes(t.id)), [tagIds.join(",")]);

  const keys = useMemo(() => ({ from: newPickKey("from"), to: newPickKey("to"), date: newPickKey("date"), cat: newPickKey("tcat"), tags: newPickKey("ttags") }), []);
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => setCategoryId(v), []));
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  usePickResult<string>(keys.from, useCallback((v: string) => setFromId(v), []));
  usePickResult<string>(keys.to, useCallback((v: string) => setToId(v), []));
  usePickResult<string>(keys.date, useCallback((day: string) => setDate((d) => (day === d.slice(0, 10) ? d : day === todayLocal() ? localIso() : dayWithNow(day))), []));

  // Fetch a rate only when the transfer actually crosses currencies.
  useEffect(() => {
    let alive = true;
    if (!cross || !from || !to) { setRate(null); return; }
    rateOrFallback(db, from.currency, to.currency).then((r) => { if (alive) setRate(r); });
    return () => { alive = false; };
  }, [cross, from?.currency, to?.currency]);

  const fromValue = evalExpr(fromExpr);
  const manualTo = evalExpr(toExpr);
  const toValue = cross ? (toExpr ? manualTo : fromValue !== null && rate ? Math.round(fromValue * rate.rate * 100) / 100 : null) : fromValue;
  const valid = !!from && !!to && from.id !== to.id && fromValue !== null && fromValue > 0 && toValue !== null && toValue > 0;

  const commit = () => {
    if (!valid || !from || !to) return;
    mutate((d) => {
      if (legs.length) for (const l of legs) remove(d, "transactions", l.id);
      createTransfer(d, { from_account_id: from.id, to_account_id: to.id, date, from_amount_minor: toMinor(fromValue!, from.currency), to_amount_minor: toMinor(toValue!, to.currency), from_currency: from.currency, to_currency: to.currency, notes: note || null, category_id: categoryId, tag_ids: JSON.stringify(tagIds) });
    });
    if (stacked) router.dismiss(2); else router.back();
  };
  const del = () => Alert.alert("Delete transfer?", undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => { for (const l of legs) remove(d, "transactions", l.id); }); router.back(); } },
  ]);

  const effRate = fromValue && toValue ? toValue / fromValue : rate?.rate;
  const pickFrom = () => router.push({ pathname: "/pick/account", params: { key: keys.from, selected: fromId } });
  const pickTo = () => router.push({ pathname: "/pick/account", params: { key: keys.to, selected: toId } });

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <View style={styles.headRow}>
            <Subtle style={{ flex: 1 }}>Transfer</Subtle>
            {stacked ? <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to expense" style={styles.back}><SymbolView name="chevron.left" size={13} tintColor={C.tint} /><Text style={styles.backText}>Back</Text></Pressable> : null}
          </View>
          <Leg role="From" account={from?.name} amount={fromExpr || (fromValue !== null ? String(fromValue) : "0")} currency={from?.currency ?? ""}
            active={side === "from"} onPress={() => setSide("from")} onPickAccount={pickFrom} negative
            balance={balances.from} after={fromValue !== null && from ? balances.from - toMinor(fromValue, from.currency) : null} />
          <View style={styles.arrow}><SymbolView name="arrow.down" size={18} tintColor={C.tertiary} /></View>
          <Leg role="To" account={to?.name} amount={cross ? (toExpr || (toValue !== null ? String(toValue) : "…")) : fromExpr || "0"} currency={to?.currency ?? ""}
            active={side === "to"} onPress={() => cross && setSide("to")} onPickAccount={pickTo}
            balance={balances.to} after={toValue !== null && to ? balances.to + toMinor(toValue, to.currency) : null} />
          <Text style={styles.meta}>
            {cross && effRate ? `1 ${from!.currency} = ${effRate.toFixed(4)} ${to!.currency}${rate?.stale ? " (cached rate)" : toExpr ? " (manual)" : rate ? " (ECB)" : ""}` : cross ? "Fetching rate…" : " "}
          </Text>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="calendar" label={dayLabel(date)} active={date.slice(0, 10) !== todayLocal()} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: date.slice(0, 10) } })} />
            {cross ? <Chip icon="arrow.triangle.2.circlepath" label={toExpr ? "ECB rate" : "Auto rate"} active={!toExpr} onPress={() => setToExpr("")} /> : null}
          </ChipRow>
          <ChipRow>
            <Chip icon="folder" label={category?.name ?? "Category"} active={!!category} onPress={() => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: "expense", selected: categoryId ?? "" } })} />
            <Chip icon="number" label={tags.length ? tags.map((t) => `#${t.name}`).join(" ") : "Tags"} active={tags.length > 0} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } })} />
          </ChipRow>
          <Keypad value={side === "from" ? fromExpr : toExpr} onChange={side === "from" ? setFromExpr : setToExpr} allowSign={false}
            extra={{ label: side === "from" ? (cross ? "Edit receiving" : "Same amount") : "Edit sending", icon: "arrow.up.arrow.down", active: side === "to", onPress: () => cross && setSide((s) => (s === "from" ? "to" : "from")) }} />
          <ConfirmBar amount={fromValue !== null && from ? `${fromValue} ${from.currency}${cross && toValue !== null && to ? ` → ${toValue} ${to.currency}` : ""}` : "0"} label={valid ? (legs.length ? "Tap to save" : "Tap to transfer") : "Enter an amount"} onPress={commit} disabled={!valid} />
          {legs.length ? <DeleteRow label="Delete transfer" onPress={del} /> : null}
        </>
      }
    />
  );
}

/**
 * One side of the transfer: which account, how much leaves or arrives, and what the account holds
 * before and after. The balances are always drawn here, unlike the entry sheet's single folded one
 * — a transfer is about moving money between two balances, and both of them are the answer.
 *
 * Tapping the card chooses which side the keypad types into; tapping the account line opens the
 * picker. Two jobs, two targets, because the card is also a big button.
 */
function Leg({ role, account, amount, currency, active, onPress, onPickAccount, negative, balance, after }: {
  role: "From" | "To"; account?: string; amount: string; currency: string; active: boolean;
  onPress: () => void; onPickAccount: () => void; negative?: boolean; balance: number; after: number | null;
}) {
  const moved = after !== null && after !== balance;
  return (
    <Pressable onPress={onPress} style={[styles.leg, active && styles.legActive]} accessibilityRole="button"
      accessibilityLabel={`${role} ${account ?? "no account"}: ${amount} ${currency}`} accessibilityState={{ selected: active }}>
      <Pressable onPress={onPickAccount} style={styles.legHead} accessibilityRole="button" accessibilityLabel={`${role}: ${account ?? "choose an account"}`}>
        <Text style={styles.legLabel} numberOfLines={1}>{role}{account ? ` · ${account}` : ""}</Text>
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
      <Text style={[styles.legAmount, negative ? null : { color: C.green }]} numberOfLines={1} adjustsFontSizeToFit>{negative ? "−" : "+"}{amount} <Text style={styles.legCur}>{currency}</Text></Text>
      {currency ? (
        <View style={styles.legBalance} accessibilityLabel={moved ? `Balance ${formatMinor(balance, currency)}, after ${formatMinor(after, currency)} ${currency}` : `Balance ${formatMinor(balance, currency)} ${currency}`}>
          <Text style={styles.balanceText}>{formatMinor(balance, currency)}</Text>
          {moved ? <>
            <SymbolView name="arrow.right" size={10} tintColor={C.tertiary} />
            <Text style={[styles.balanceText, { fontWeight: "600", color: after < 0 ? C.red : C.label }]}>{formatMinor(after, currency)}</Text>
          </> : null}
          <Text style={styles.balanceText}>{currency}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.sm, gap: 6 },
  headRow: { flexDirection: "row", alignItems: "center", marginBottom: 2 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.fill, borderRadius: 14, paddingHorizontal: 10, height: 28 },
  backText: { color: C.tint, fontSize: 14, fontWeight: "600" },
  leg: { backgroundColor: C.card, borderRadius: 14, padding: S.md, borderWidth: 2, borderColor: "transparent" },
  legActive: { borderColor: C.tint },
  legHead: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 2, paddingRight: 4 },
  legLabel: { color: C.secondary, fontSize: 13, flexShrink: 1 },
  legBalance: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  balanceText: { color: C.tertiary, fontSize: 12, fontVariant: ["tabular-nums"] },
  legAmount: { fontSize: 30, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  legCur: { fontSize: 15, color: C.secondary },
  arrow: { alignItems: "center", height: 18 },
  meta: { color: C.tertiary, fontSize: 13, marginTop: 4, minHeight: 18 },
});
