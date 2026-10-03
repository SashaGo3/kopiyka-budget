import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, createTransfer, formatMinor, getRow, jsonIds, listRows, numberFormat, remove, toMinor, fromMinor, rateOrFallback } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { Chip, SheetFrame, Subtle, ChipRow, DeleteRow } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { dayLabel, dayWithNow, localIso, todayLocal } from "@/lib/dates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";
import { catName, acctName } from "@/lib/names";

type Params = { id: string; from?: string; to?: string; amount?: string; stacked?: string;
  // Carried over from the entry sheet: `convert` is the saved entry that becomes one leg of this transfer.
  convert?: string; note?: string; date?: string; category?: string; tags?: string };

/**
 * Transfer between two accounts. When currencies differ, the destination amount
 * is prefilled from Frankfurter (cached) and can be overridden on the keypad.
 *
 * A new transfer is filled in order: the account the money leaves, the one it arrives in, then the
 * amount. Neither account is guessed — a transfer filed between the wrong two accounts moves two
 * balances wrongly and looks right — so a side nobody chose opens its picker, and the keypad waits
 * until both are chosen. The caller can name one side (the account screen, the entry sheet), because
 * there the account was already a choice.
 */
export default function TransferSheet() {
  const p = useLocalSearchParams<Params>();
  /** Opened on top of the entry sheet: Back returns there, saving closes both. */
  const stacked = p.stacked === "1";
  const isNew = p.id === "new";
  const legs = useMemo(() => (isNew ? [] : listRows(db, "transactions", "deleted=0 AND transfer_id=?", [p.id])), [isNew, p.id]);
  const outLeg = legs.find((l) => l.amount_minor < 0), inLeg = legs.find((l) => l.amount_minor >= 0);
  // An expense or income being turned into a transfer keeps its id as the leg on its own account
  // (createTransfer's `keep`), so its photo, place and history stay where they are.
  const source = useMemo(() => (isNew && p.convert ? getRow(db, "transactions", p.convert) ?? null : null), [isNew, p.convert]);

  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  const [fromId, setFromId] = useState(outLeg?.account_id ?? p.from ?? "");
  const [toId, setToId] = useState(inLeg?.account_id ?? p.to ?? "");
  const from = accounts.find((a) => a.id === fromId), to = accounts.find((a) => a.id === toId);
  const ready = !!from && !!to && from.id !== to.id;
  const cross = ready && from.currency !== to.currency;

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
  const [date, setDate] = useState(outLeg?.date ?? p.date ?? localIso());
  const [note, setNote] = useState(outLeg?.notes ?? p.note ?? "");
  // Transfers can be categorised and tagged like any entry (e.g. "Savings", #vacation); both legs share them.
  const [categoryId, setCategoryId] = useState<string | null>(outLeg?.category_id ?? p.category ?? null);
  const [tagIds, setTagIds] = useState<string[]>(() => outLeg ? jsonIds(outLeg.tag_ids) : p.tags ? p.tags.split(",").filter(Boolean) : []);
  // Closing with changes asks first (lib/discard.ts).
  const exit = useDiscardGuard(useDirty([fromId, toId, fromExpr, toExpr, date, note, categoryId, tagIds]));
  const category = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) ?? null : null), [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((x) => tagIds.includes(x.id)), [tagIds.join(",")]);

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

  // `evalPartial`, as on the Log sheet: each leg shows what its sum comes to, and the sum itself is
  // written out under the legs for the side being typed.
  const fromValue = evalPartial(fromExpr);
  const manualTo = evalPartial(toExpr);
  const toValue = cross ? (toExpr ? manualTo : fromValue !== null && rate ? Math.round(fromValue * rate.rate * 100) / 100 : null) : fromValue;
  const valid = ready && fromValue !== null && fromValue > 0 && toValue !== null && toValue > 0;

  const commit = () => {
    if (!valid || !from || !to) return;
    mutate((d) => {
      if (legs.length) for (const l of legs) remove(d, "transactions", l.id);
      createTransfer(d, { from_account_id: from.id, to_account_id: to.id, date, from_amount_minor: toMinor(fromValue!, from.currency), to_amount_minor: toMinor(toValue!, to.currency), from_currency: from.currency, to_currency: to.currency, notes: note || null, category_id: categoryId, tag_ids: JSON.stringify(tagIds),
        ...(source ? { keep: { row: source, leg: source.amount_minor < 0 ? "out" as const : "in" as const } } : {}) });
    });
    exit(() => { if (stacked) router.dismiss(2); else router.back(); });
  };
  const del = () => Alert.alert(t("transfer.deleteTitle"), undefined, [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => { for (const l of legs) remove(d, "transactions", l.id); }); exit(() => router.back()); } },
  ]);

  const effRate = fromValue && toValue ? toValue / fromValue : rate?.rate;
  // Each picker leaves out the other side's account: a transfer to the same account is not one.
  const pickFrom = () => router.push({ pathname: "/pick/account", params: { key: keys.from, selected: fromId, exclude: toId } });
  const pickTo = () => router.push({ pathname: "/pick/account", params: { key: keys.to, selected: toId, exclude: fromId } });
  // The side still missing opens its picker by itself, From before To, each once: closing a picker
  // without choosing leaves the card saying so rather than reopening it. Marked inside the timer,
  // not before it, so an effect run twice (StrictMode) still opens it.
  const asked = useRef({ from: false, to: false });
  useEffect(() => {
    if (!isNew) return;
    const missing = !fromId ? "from" : !toId ? "to" : null;
    if (!missing || asked.current[missing]) return;
    const timer = setTimeout(() => { asked.current[missing] = true; if (missing === "from") pickFrom(); else pickTo(); }, 350);
    return () => clearTimeout(timer);
  }, [isNew, fromId, toId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <View style={styles.headRow}>
            <Subtle style={{ flex: 1 }}>{t("transfer.title")}</Subtle>
            {stacked ? <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("transfer.backA11y")} style={styles.back}><SymbolView name="chevron.left" size={13} tintColor={C.tint} /><Text style={styles.backText} numberOfLines={1} maxFontSizeMultiplier={1.3}>{t("common.back")}</Text></Pressable> : null}
          </View>
          <Leg role={t("transfer.from")} account={acctName(from)} amount={fromValue !== null && from ? formatMinor(toMinor(fromValue, from.currency), from.currency) : "0"} currency={from?.currency ?? ""}
            active={ready && side === "from"} onPress={() => (from ? setSide("from") : pickFrom())} onPickAccount={pickFrom} negative
            balance={balances.from} after={fromValue !== null && from ? balances.from - toMinor(fromValue, from.currency) : null} />
          <View style={styles.arrow}><SymbolView name="arrow.down" size={18} tintColor={C.tertiary} /></View>
          <Leg role={t("transfer.to")} account={acctName(to)} amount={toValue !== null && to ? formatMinor(toMinor(toValue, to.currency), to.currency) : cross ? "…" : "0"} currency={to?.currency ?? ""}
            active={ready && side === "to"} onPress={() => (!to ? pickTo() : cross && setSide("to"))} onPickAccount={pickTo}
            balance={balances.to} after={toValue !== null && to ? balances.to + toMinor(toValue, to.currency) : null} />
          <CalcLine expr={side === "from" ? fromExpr : toExpr} style={{ textAlign: "left" }} />
          <Text style={styles.meta}>
            {!ready ? (!from ? t("transfer.chooseFrom") : t("transfer.chooseTo")) : cross && effRate ? rateLine(from!.currency, to!.currency, effRate, rate?.stale ? "cached" : toExpr ? "manual" : rate ? "ecb" : "plain") : cross ? t("transfer.rate.fetching") : " "}
          </Text>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="calendar" label={dayLabel(date)} active={date.slice(0, 10) !== todayLocal()} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: date.slice(0, 10) } })} />
            {cross ? <Chip icon="arrow.triangle.2.circlepath" label={toExpr ? t("transfer.ecbRate") : t("transfer.autoRate")} active={!toExpr} onPress={() => setToExpr("")} /> : null}
          </ChipRow>
          <ChipRow>
            <Chip icon="folder" label={category ? catName(category) : t("transfer.category")} active={!!category} onPress={() => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: "expense", selected: categoryId ?? "" } })} />
            <Chip icon="number" label={tags.length ? tags.map((x) => `#${x.name}`).join(" ") : t("transfer.tags")} active={tags.length > 0} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } })} />
          </ChipRow>
          {/* Waits for both accounts: the amount is the last thing a transfer is told. */}
          <View pointerEvents={ready ? "auto" : "none"} style={ready ? null : styles.waiting} accessibilityElementsHidden={!ready} importantForAccessibility={ready ? "auto" : "no-hide-descendants"}>
          <Keypad value={side === "from" ? fromExpr : toExpr} onChange={side === "from" ? setFromExpr : setToExpr} allowSign={false}
            extra={{ label: side === "from" ? (cross ? t("transfer.editReceiving") : t("transfer.sameAmount")) : t("transfer.editSending"), icon: "arrow.up.arrow.down", active: side === "to", onPress: () => cross && setSide((s) => (s === "from" ? "to" : "from")) }} />
          </View>
          <ConfirmBar amount={fromValue !== null && from ? `${formatMinor(toMinor(fromValue, from.currency), from.currency)} ${from.currency}${cross && toValue !== null && to ? ` → ${formatMinor(toMinor(toValue, to.currency), to.currency)} ${to.currency}` : ""}` : "0"} label={valid ? (legs.length ? t("transfer.tapToSave") : t("transfer.tapToTransfer")) : ready ? t("transfer.enterAmount") : t("transfer.chooseAccounts")} onPress={commit} disabled={!valid} />
          {legs.length ? <DeleteRow label={t("transfer.delete")} onPress={del} /> : null}
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
  role: string; account?: string; amount: string; currency: string; active: boolean;
  onPress: () => void; onPickAccount: () => void; negative?: boolean; balance: number; after: number | null;
}) {
  const moved = after !== null && after !== balance;
  return (
    <Pressable onPress={onPress} style={[styles.leg, active && styles.legActive]} accessibilityRole="button"
      accessibilityLabel={t("transfer.legA11y", { role, account: account ?? t("transfer.noAccount"), amount, currency })} accessibilityState={{ selected: active }}>
      <Pressable onPress={onPickAccount} style={styles.legHead} accessibilityRole="button" accessibilityLabel={t("transfer.pickA11y", { role, account: account ?? t("transfer.chooseAccount") })}>
        <Text style={[styles.legLabel, !account && { color: C.tint, fontWeight: "600" }]} numberOfLines={1}>{role} · {account ?? t("transfer.chooseAccount")}</Text>
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
      <Text style={[styles.legAmount, negative ? null : { color: C.green }]} numberOfLines={1} adjustsFontSizeToFit>{negative ? "−" : "+"}{amount} <Text style={styles.legCur}>{currency}</Text></Text>
      {currency ? (
        <View style={styles.legBalance} accessibilityLabel={moved ? t("transfer.balanceAfterA11y", { balance: formatMinor(balance, currency), after: formatMinor(after, currency), currency }) : t("transfer.balanceA11y", { balance: formatMinor(balance, currency), currency })}>
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

/** "1 EUR = 41,2345 UAH (ECB)": the rate in the language's decimal separator, and where it came from. */
function rateLine(from: string, to: string, value: number, source: "cached" | "manual" | "ecb" | "plain"): string {
  const vars = { from, to, rate: value.toFixed(4).replace(".", numberFormat().decimal) };
  switch (source) {
    case "cached": return t("transfer.rate.cached", vars);
    case "manual": return t("transfer.rate.manual", vars);
    case "ecb": return t("transfer.rate.ecb", vars);
    default: return t("transfer.rate.plain", vars);
  }
}

const styles = themed(() => StyleSheet.create({
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
  waiting: { opacity: 0.35 },
}));
