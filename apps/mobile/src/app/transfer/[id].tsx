import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, createTransfer, formatMinor, getRow, jsonIds, listRows, numberFormat, remove, toMinor, fromMinor, rateOrFallback, updateTransfer, deriveTransfer, type Side } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { ButtonText, Chip, SheetFrame, Subtle, ChipRow, DeleteRow } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { dayLabel, dayWithNow, localIso, todayLocal } from "@/lib/dates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";
import { catName, acctName } from "@/lib/names";


type Params = { id: string; from?: string; to?: string; amount?: string; stacked?: string;
  // Carried over from the entry sheet: `convert` is the saved entry that becomes one leg of this transfer.
  convert?: string; note?: string; date?: string; category?: string; tags?: string };

/**
 * Transfer between two accounts.
 *
 * A new transfer is filled in order: the account the money leaves, the one it arrives in, then the
 * amount. Neither account is guessed — a transfer filed between the wrong two accounts moves two
 * balances wrongly and looks right — so a side nobody chose opens its picker, and the keypad waits
 * until both are chosen. The caller can name one side (the account screen, an entry being turned into
 * a transfer), because there the account was already a choice.
 *
 * Both amounts can always be typed. Whichever side was typed last leads and the other follows it at
 * the rate (1 for one currency) — until that side is typed too, after which both stay exactly as
 * typed and the rate line says what they imply: a bank's own conversion, or a fee taken on the way,
 * is never overwritten by a number the app worked out (lib/transferAmounts.ts).
 *
 * An existing transfer is rewritten in place (core `updateTransfer`): both legs keep their ids, and a
 * transfer the notification automation put together keeps the account numbers it was paired by.
 * Saving one that is still pending approves it.
 */
export default function TransferSheet() {
  const p = useLocalSearchParams<Params>();
  /** Opened on top of the entry sheet: Back returns there, saving closes both. */
  const stacked = p.stacked === "1";
  const isNew = p.id === "new";
  const legs = useMemo(() => (isNew ? [] : listRows(db, "transactions", "deleted=0 AND transfer_id=?", [p.id])), [isNew, p.id]);
  const outLeg = legs.find((l) => l.amount_minor < 0) ?? legs[0], inLeg = legs.find((l) => l !== outLeg);
  const wasPending = legs.some((l) => l.pending === 1);
  // An expense or income being turned into a transfer keeps its id as the leg on its own account
  // (createTransfer's `keep`), so its photo, place and history stay where they are.
  const source = useMemo(() => (isNew && p.convert ? getRow(db, "transactions", p.convert) ?? null : null), [isNew, p.convert]);

  // The pickers offer live accounts only; an archived account a saved transfer already uses is still
  // shown here, or the sheet would claim the transfer has no account at all.
  const legAccounts = [outLeg?.account_id ?? "", inLeg?.account_id ?? ""];
  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND (archived=0 OR id IN (?, ?))", legAccounts, "sort, name"), legAccounts);
  const [fromId, setFromId] = useState(outLeg?.account_id ?? p.from ?? "");
  const [toId, setToId] = useState(inLeg?.account_id ?? p.to ?? "");
  const from = accounts.find((a) => a.id === fromId), to = accounts.find((a) => a.id === toId);
  const same = !!from && !!to && from.id === to.id;
  const ready = !!from && !!to && !same;
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

  const [side, setSide] = useState<Side>("from");
  // A leg the app had to leave at 0 (no rate when the automation paired it) counts as not typed yet.
  const legExpr = (minor: number | undefined, currency: string | undefined) => (minor && currency ? String(fromMinor(Math.abs(minor), currency)) : "");
  const [fromExpr, setFromExpr] = useState(outLeg ? legExpr(outLeg.amount_minor, from?.currency) : p.amount ?? "");
  const [toExpr, setToExpr] = useState(inLeg ? legExpr(inLeg.amount_minor, to?.currency) : "");
  /** Which sides the person has typed (or a saved transfer already holds): those are never recalculated. */
  const [typed, setTyped] = useState<Record<Side, boolean>>({ from: fromExpr !== "", to: toExpr !== "" });
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

  // Fetch a rate only when the transfer actually crosses currencies. The answer is kept with the pair
  // it was asked for, so a rate for the accounts chosen a moment ago is never applied to these.
  const pair = cross ? `${from.currency}>${to.currency}` : "";
  const [fetched, setFetched] = useState<{ pair: string; rate: { rate: number; stale: boolean } | null } | null>(null);
  useEffect(() => {
    if (!pair) return;
    let alive = true;
    const [base, quote] = pair.split(">") as [string, string];
    rateOrFallback(db, base, quote).then((r) => { if (alive) setFetched({ pair, rate: r }); }, () => { if (alive) setFetched({ pair, rate: null }); });
    return () => { alive = false; };
  }, [pair]);
  const rateDone = !!pair && fetched?.pair === pair;
  const rate = rateDone ? fetched!.rate : null;

  // `evalPartial`, as on the Log sheet: each leg shows what its sum comes to, and the sum itself is
  // written out under the legs for the side being typed.
  const amounts = deriveTransfer({
    from: evalPartial(fromExpr), to: evalPartial(toExpr), typed,
    rate: !ready ? null : cross ? rate?.rate ?? null : 1,
  });
  const fromValue = amounts.from, toValue = amounts.to;
  const valid = ready && fromValue !== null && fromValue > 0 && toValue !== null && toValue > 0;

  const commit = () => {
    if (!valid || !from || !to) return;
    const fields = { from_account_id: from.id, to_account_id: to.id, date, from_amount_minor: toMinor(fromValue!, from.currency), to_amount_minor: toMinor(toValue!, to.currency),
      from_currency: from.currency, to_currency: to.currency, notes: note || null, category_id: categoryId, tag_ids: JSON.stringify(tagIds) };
    mutate((d) => {
      // Both legs of a saved transfer are rewritten where they are; only a broken one (a leg lost to
      // a deletion elsewhere) is written afresh.
      if (legs.length === 2 && p.id && updateTransfer(d, p.id, { ...fields, pending: 0 })) return;
      if (legs.length) for (const l of legs) remove(d, "transactions", l.id);
      createTransfer(d, { ...fields, ...(source ? { keep: { row: source, leg: source.amount_minor < 0 ? "out" as const : "in" as const } } : {}) });
    });
    exit(() => { if (stacked) router.dismiss(2); else router.back(); });
  };
  const del = () => Alert.alert(t("transfer.deleteTitle"), undefined, [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => { for (const l of legs) remove(d, "transactions", l.id); }); exit(() => router.back()); } },
  ]);

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

  // Typing into a side the app filled in starts it over (the first key replaces the derived figure);
  // clearing a side hands it back to the rate.
  const expr = side === "from" ? fromExpr : toExpr;
  const onType = (next: string) => {
    if (side === "from") setFromExpr(next); else setToExpr(next);
    setTyped((cur) => ({ ...cur, [side]: next !== "" }));
  };
  const other: Side = side === "from" ? "to" : "from";
  /** Let the other side follow the rate again, after both were typed. */
  const followRate = () => {
    if (other === "from") setFromExpr(""); else setToExpr("");
    setTyped((cur) => ({ ...cur, [other]: false }));
  };
  /** Turn the transfer round: accounts and amounts change places. */
  const swap = () => {
    setFromId(toId); setToId(fromId);
    setFromExpr(toExpr); setToExpr(fromExpr);
    setTyped((cur) => ({ from: cur.to, to: cur.from }));
    setSide((s) => (s === "from" ? "to" : "from"));
  };
  const show = (v: number | null, cur: string | undefined) => (v !== null && cur ? formatMinor(toMinor(v, cur), cur) : null);
  const fromShown = show(fromValue, from?.currency), toShown = show(toValue, to?.currency);
  // Whichever side is not typed and has no figure: it waits on the rate (or, without one, on the person).
  const waiting = (s: Side) => (ready && !typed[s] && (s === "from" ? fromValue : toValue) === null && (typed.from || typed.to));

  const effRate = fromValue && toValue ? toValue / fromValue : rate?.rate;
  const meta = (() => {
    if (same) return t("transfer.sameAccount");
    if (!ready) return !from ? t("transfer.chooseFrom") : t("transfer.chooseTo");
    if (!cross) {
      // One currency and two different figures: what went missing on the way.
      const gap = fromValue !== null && toValue !== null && typed.from && typed.to ? toMinor(toValue, to.currency) - toMinor(fromValue, from.currency) : 0;
      if (gap) return t(gap < 0 ? "transfer.difference" : "transfer.differenceMore", { amount: formatMinor(Math.abs(gap), from.currency), currency: from.currency });
      return " ";
    }
    if (typed.from && typed.to && effRate) return rateLine(from.currency, to.currency, effRate, "manual");
    if (rate && effRate) return rateLine(from.currency, to.currency, effRate, rate.stale ? "cached" : "ecb");
    return rateDone ? t("transfer.rate.none") : t("transfer.rate.fetching");
  })();
  const keyLabel = side === "from" ? t("transfer.editReceiving") : t("transfer.editSending");

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <View style={styles.headRow}>
            <Subtle style={{ flex: 1 }}>{wasPending ? t("transfer.reviewTitle") : t("transfer.title")}</Subtle>
            {stacked ? <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("transfer.backA11y")} style={styles.back}><SymbolView name="chevron.left" size={13} tintColor={C.tint} /><Text style={styles.backText} maxFontSizeMultiplier={1.3}>{t("common.back")}</Text></Pressable> : null}
          </View>
          <Leg role={t("transfer.from")} account={acctName(from)} amount={fromShown ?? (fromValue !== null ? String(fromValue) : waiting("from") ? "…" : "0")} currency={from?.currency ?? ""} derived={ready && !typed.from && fromShown !== null}
            active={ready && side === "from"} onPress={() => (from ? setSide("from") : pickFrom())} onPickAccount={pickFrom} negative
            balance={balances.from} after={fromValue !== null && from ? balances.from - toMinor(fromValue, from.currency) : null} />
          <View style={styles.arrowRow}>
            <SymbolView name="arrow.down" size={18} tintColor={C.tertiary} />
            {from && to ? (
              <Pressable onPress={swap} hitSlop={10} style={styles.swap} accessibilityRole="button" accessibilityLabel={t("transfer.swapA11y")}>
                <SymbolView name="arrow.up.arrow.down" size={13} tintColor={C.tint} />
              </Pressable>
            ) : null}
          </View>
          <Leg role={t("transfer.to")} account={acctName(to)} amount={toShown ?? (toValue !== null ? String(toValue) : waiting("to") ? "…" : "0")} currency={to?.currency ?? ""} derived={ready && !typed.to && toShown !== null}
            active={ready && side === "to"} onPress={() => (to ? setSide("to") : pickTo())} onPickAccount={pickTo}
            balance={balances.to} after={toValue !== null && to ? balances.to + toMinor(toValue, to.currency) : null} />
          <CalcLine expr={expr} style={{ textAlign: "left" }} />
          <Text style={styles.meta}>{meta}</Text>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="calendar" label={dayLabel(date)} active={date.slice(0, 10) !== todayLocal()} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: date.slice(0, 10) } })} />
            {ready && typed.from && typed.to && (cross ? !!rate : true) ? <Chip icon="arrow.triangle.2.circlepath" label={cross ? t("transfer.useRate") : t("transfer.sameAmount")} onPress={followRate} /> : null}
          </ChipRow>
          <ChipRow>
            <Chip icon="folder" label={category ? catName(category) : t("transfer.category")} active={!!category} onPress={() => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: "expense", selected: categoryId ?? "" } })} />
            <Chip icon="number" label={tags.length ? tags.map((x) => `#${x.name}`).join(" ") : t("transfer.tags")} active={tags.length > 0} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } })} />
          </ChipRow>
          {/* Waits for both accounts: the amount is the last thing a transfer is told. */}
          <View pointerEvents={ready ? "auto" : "none"} style={ready ? null : styles.waiting} accessibilityElementsHidden={!ready} importantForAccessibility={ready ? "auto" : "no-hide-descendants"}>
            <Keypad value={typed[side] ? expr : ""} onChange={onType} allowSign={false}
              extra={{ label: keyLabel, icon: "arrow.up.arrow.down", active: side === "to", onPress: () => setSide(other) }} />
          </View>
          <ConfirmBar amount={fromShown && from ? `${fromShown} ${from.currency}${toShown && to && (cross || toShown !== fromShown) ? ` → ${toShown} ${to.currency}` : ""}` : "0"}
            label={valid ? (wasPending ? t("transfer.approve") : legs.length ? t("transfer.tapToSave") : t("transfer.tapToTransfer")) : ready ? t("transfer.enterAmount") : t("transfer.chooseAccounts")} onPress={commit} disabled={!valid} />
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
 * picker. Two jobs, two targets, because the card is also a big button. A figure the app worked out
 * from the other side is drawn lighter than one that was typed.
 */
function Leg({ role, account, amount, currency, active, derived, onPress, onPickAccount, negative, balance, after }: {
  role: string; account?: string; amount: string; currency: string; active: boolean; derived: boolean;
  onPress: () => void; onPickAccount: () => void; negative?: boolean; balance: number; after: number | null;
}) {
  const moved = after !== null && after !== balance;
  return (
    <Pressable onPress={onPress} style={[styles.leg, active && styles.legActive]} accessibilityRole="button"
      accessibilityLabel={t("transfer.legA11y", { role, account: account ?? t("transfer.noAccount"), amount, currency })} accessibilityState={{ selected: active }}>
      <Pressable onPress={onPickAccount} style={styles.legHead} accessibilityRole="button" accessibilityLabel={t("transfer.pickA11y", { role, account: account ?? t("transfer.chooseAccount") })}>
        <Text style={[styles.legLabel, !account && { color: C.tint, fontWeight: "600" }]}>{role} · {account ?? t("transfer.chooseAccount")}</Text>
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
      <ButtonText fit={1} style={[styles.legAmount, negative ? null : { color: C.green }, derived && styles.legDerived]}>{negative ? "−" : "+"}{amount} <Text style={styles.legCur}>{currency}</Text></ButtonText>
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
  back: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.fill, borderRadius: 14, paddingHorizontal: 10, minHeight: 28 },
  backText: { color: C.tint, fontSize: 14, fontWeight: "600" },
  leg: { backgroundColor: C.card, borderRadius: 14, padding: S.md, borderWidth: 2, borderColor: "transparent" },
  legActive: { borderColor: C.tint },
  legHead: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 2, paddingRight: 4 },
  legLabel: { color: C.secondary, fontSize: 13, flexShrink: 1 },
  legBalance: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  balanceText: { color: C.tertiary, fontSize: 12, fontVariant: ["tabular-nums"] },
  legAmount: { fontSize: 30, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  legDerived: { opacity: 0.55 },
  legCur: { fontSize: 15, color: C.secondary },
  arrowRow: { alignItems: "center", justifyContent: "center", height: 22 },
  swap: { position: "absolute", right: 0, flexDirection: "row", alignItems: "center", backgroundColor: C.fill, borderRadius: 12, paddingHorizontal: 10, height: 24 },
  meta: { color: C.tertiary, fontSize: 13, marginTop: 4, minHeight: 18 },
  waiting: { opacity: 0.35 },
}));
