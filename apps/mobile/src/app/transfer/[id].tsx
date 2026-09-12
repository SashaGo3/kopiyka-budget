import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { createTransfer, getRow, jsonIds, listRows, remove, toMinor, fromMinor, rateOrFallback } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, SheetFrame, Subtle, ChipRow, DeleteRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { dayLabel, dayWithNow, localIso, todayLocal } from "@/lib/dates";

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
  const [fromId, setFromId] = useState(outLeg?.account_id ?? p.from ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(inLeg?.account_id ?? p.to ?? accounts.find((a) => a.id !== (outLeg?.account_id ?? p.from ?? accounts[0]?.id))?.id ?? "");
  const from = accounts.find((a) => a.id === fromId), to = accounts.find((a) => a.id === toId);
  const cross = !!from && !!to && from.currency !== to.currency;

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

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <View style={styles.headRow}>
            <Subtle style={{ flex: 1 }}>Transfer</Subtle>
            {stacked ? <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to expense" style={styles.back}><SymbolView name="chevron.left" size={13} tintColor={C.tint} /><Text style={styles.backText}>Back</Text></Pressable> : null}
          </View>
          <Leg label={from?.name ?? "From"} amount={fromExpr || (fromValue !== null ? String(fromValue) : "0")} currency={from?.currency ?? ""} active={side === "from"} onPress={() => setSide("from")} negative />
          <View style={styles.arrow}><SymbolView name="arrow.down" size={18} tintColor={C.tertiary} /></View>
          <Leg label={to?.name ?? "To"} amount={cross ? (toExpr || (toValue !== null ? String(toValue) : "…")) : fromExpr || "0"} currency={to?.currency ?? ""} active={side === "to"} onPress={() => cross && setSide("to")} />
          <Text style={styles.meta}>
            {cross && effRate ? `1 ${from!.currency} = ${effRate.toFixed(4)} ${to!.currency}${rate?.stale ? " (cached rate)" : toExpr ? " (manual)" : rate ? " (ECB)" : ""}` : cross ? "Fetching rate…" : " "}
          </Text>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="arrow.up.circle" label="From" onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.from, selected: fromId } })} />
            <Chip icon="arrow.down.circle" label="To" onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.to, selected: toId } })} />
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

function Leg({ label, amount, currency, active, onPress, negative }: { label: string; amount: string; currency: string; active: boolean; onPress: () => void; negative?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.leg, active && styles.legActive]} accessibilityRole="button" accessibilityLabel={`${negative ? "From" : "To"} ${label}: ${amount} ${currency}`} accessibilityState={{ selected: active }}>
      <Text style={styles.legLabel}>{label}</Text>
      <Text style={[styles.legAmount, negative ? null : { color: C.green }]} numberOfLines={1} adjustsFontSizeToFit>{negative ? "−" : "+"}{amount} <Text style={styles.legCur}>{currency}</Text></Text>
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
  legLabel: { color: C.secondary, fontSize: 13 },
  legAmount: { fontSize: 30, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  legCur: { fontSize: 15, color: C.secondary },
  arrow: { alignItems: "center", height: 18 },
  meta: { color: C.tertiary, fontSize: 13, marginTop: 4, minHeight: 18 },
});
