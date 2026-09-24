import { useCallback, useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatMinor, fromMinor, getRow, rateOrFallback, save, toMinor, tripStats, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { AmountPill, CategoryIcon, Chip, ChipRow, Money, ProgressBar } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { endTravel, tripLine } from "@/lib/travel";

/**
 * A trip (travel mode budget): remaining, progress, day counter and the daily allowance,
 * then the split by category. Ignores the account scope: a trip is paid from anywhere.
 * Tapping the head opens Transactions filtered by the trip tag.
 *
 * The full card can change the trip while it runs: its budget at any time (a trip rarely costs what
 * was guessed on the way to the airport), and while it is on, its currency, its dates and ending it.
 * A budget in another currency than the home one says what it is at home too.
 *
 * Once the trip is over the full card is its summary: how it came out against the plan, the pace
 * per day against the pace planned, and each category's share of the whole.
 */
export function TripCard({ budget, compact, onRemove }: { budget: Budget; compact?: boolean; onRemove?: () => void }) {
  const currencies = useQuery((d) => d.all<{ c: string }>(`SELECT DISTINCT currency AS c FROM accounts WHERE deleted=0`).map((r) => r.c));
  const { rateFor } = useRates(currencies, budget.currency);
  const today = useQuery(() => todayLocal());
  // Recomputed on every render: a couple of tiny queries, and `rateFor` changes once rates arrive.
  const s = tripStats(db, budget, { rateFor, today });
  const ratio = s.limit_minor > 0 ? Math.min(1, s.spent_minor / s.limit_minor) : 0;
  const open = (category?: string | null) => router.push({ pathname: "/transactions", params: { tag: budget.tag_id ?? "", name: s.name, ...(category !== undefined ? { category: category ?? "none" } : {}), from: "0000", nonce: String(Date.now()) } });
  const cats = new Map(s.by_category.map((c) => [c.category_id, c.category_id ? getRow(db, "categories", c.category_id) : null]));
  const when = s.active
    ? (s.days_left ? `Day ${s.day} of ${s.days} · ${s.days_left} day${s.days_left === 1 ? "" : "s"} left` : `Day ${s.day} · planned until ${humanDayTime(budget.ends ?? budget.starts)}`)
    : `${humanDayTime(budget.starts, null, undefined, true)} → ${humanDayTime(budget.ended ?? budget.ends ?? budget.starts, null, undefined, true)} · ${s.days} day${s.days === 1 ? "" : "s"}`;
  const fmt = (m: number) => formatMinor(m, s.currency);
  const keys = useMemo(() => ({ amount: newPickKey("tripamt"), currency: newPickKey("tripcur") }), []);
  // Another currency keeps the same budget, converted at today's rate; with no rate there is
  // nothing honest to convert it with, so it is refused rather than guessed.
  usePickResult<string>(keys.currency, useCallback((next: string) => {
    const b = getRow(db, "budgets", budget.id);
    if (!b || next === b.currency) return;
    void rateOrFallback(db, b.currency, next).then((r) => {
      if (!r) { Alert.alert(`No exchange rate for ${next}`, "Connect to the internet once, or keep the budget in its currency."); return; }
      mutate((d) => save(d, "budgets", { ...b, currency: next, amount_minor: toMinor(Math.round(fromMinor(b.amount_minor, b.currency) * r.rate * 100) / 100, next) }));
    }).catch(() => Alert.alert(`No exchange rate for ${next}`));
  }, [budget.id]));
  const editCurrency = () => router.push({ pathname: "/pick/currency", params: { key: keys.currency, selected: s.currency, title: "Budget currency" } });
  const base = useQuery(() => getBaseCurrency());
  const toBase = s.currency !== base ? rateFor(s.currency, base) : null;
  /** An amount of the trip's currency in the home one, or null when they are the same or no rate is cached. */
  const atHome = (m: number) => (toBase !== null ? `${formatMinor(toMinor(fromMinor(m, s.currency) * toBase, base), base)} ${base}` : null);
  const plannedPerDay = Math.round(s.limit_minor / s.days);
  usePickResult<number>(keys.amount, useCallback((minor: number) => {
    const b = getRow(db, "budgets", budget.id);
    if (b) mutate((d) => save(d, "budgets", { ...b, amount_minor: minor }));
  }, [budget.id]));
  const editBudget = () => router.push({ pathname: "/pick/amount", params: { key: keys.amount, title: `Budget for ${s.name}`, currency: s.currency, value: String(budget.amount_minor) } });
  const editDates = () => router.push({ pathname: "/travel/dates", params: { budget: budget.id } });
  const end = () => Alert.alert(`End travel mode for ${s.name}?`, `${tripLine(s)}. New expenses stop getting the “${s.name}” tag; the budget stays on Budgets as history.`, [
    { text: "Keep travelling", style: "cancel" },
    { text: "End it", style: "destructive", onPress: () => endTravel(budget.id) },
  ]);
  const pace = s.allowance_minor !== null ? `${fmt(s.per_day_minor)}/day so far · ${fmt(Math.max(0, s.allowance_minor))}/day left` : `${fmt(s.per_day_minor)}/day`;
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.headRow}>
        <Pressable onPress={() => open()} style={styles.head} accessibilityRole="button" accessibilityLabel={`Travel ${s.name}, ${fmt(s.remaining_minor)} ${s.currency} left`}>
          <View style={styles.icon}><SymbolView name="airplane" size={18} tintColor="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.sub}>{when}</Text>
          </View>
          <AmountPill minor={s.remaining_minor} currency={s.currency} warn />
        </Pressable>
        {compact && onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8} style={styles.trash} accessibilityRole="button" accessibilityLabel={`Remove travel ${s.name}`}>
            <SymbolView name="trash" size={16} tintColor={C.red} />
          </Pressable>
        ) : null}
      </View>
      <ProgressBar ratio={ratio} color={ratio > 0.85 ? C.orange : "#0A84FF"} />
      <Text style={styles.sub}>{fmt(s.spent_minor)} of {fmt(s.limit_minor)} {s.currency}{compact ? "" : `${atHome(s.limit_minor) ? ` (≈ ${atHome(s.limit_minor)})` : ""}${s.active ? ` · ${pace}` : ""}`}</Text>
      {!compact && !s.active ? (
        <View style={styles.summary}>
          <View style={styles.verdict}>
            <SymbolView name={s.over ? "exclamationmark.circle.fill" : "party.popper.fill"} size={18} tintColor={s.over ? C.orange : C.green} />
            <Text style={[styles.verdictText, { color: s.over ? C.orange : C.green }]}>
              {s.over ? `${fmt(-s.remaining_minor)} ${s.currency} over the plan` : s.remaining_minor ? `${fmt(s.remaining_minor)} ${s.currency} left of the plan` : "Exactly as planned"}
            </Text>
          </View>
          <Text style={styles.sub}>{s.days} day{s.days === 1 ? "" : "s"} · {fmt(s.per_day_minor)} {s.currency}/day on average · planned {fmt(plannedPerDay)}/day</Text>
          {atHome(s.spent_minor) ? <Text style={styles.sub}>About {atHome(s.spent_minor)} in your home currency</Text> : null}
        </View>
      ) : null}
      {s.unconverted.length ? <Text style={styles.warn}>Not counted (no exchange rate yet): {s.unconverted.map((u) => `${formatMinor(u.minor, u.currency)} ${u.currency}`).join(", ")}</Text> : null}
      {!compact ? (
        <View style={{ marginHorizontal: -S.md, marginTop: 2 }}><ChipRow>
          <Chip icon="pencil" label={`Budget ${fmt(s.limit_minor)} ${s.currency}`} compact onPress={editBudget} />
          {s.active ? <Chip icon="dollarsign.circle" label={s.currency} compact onPress={editCurrency} /> : null}
          {s.active ? <Chip icon="calendar" label="Dates" compact onPress={editDates} /> : null}
          {s.active ? <Chip icon="stop.circle" label="End" compact tint={C.red as unknown as string} onPress={end} /> : null}
        </ChipRow></View>
      ) : null}
      {!compact && s.by_category.map((ch) => {
        const c = cats.get(ch.category_id);
        const name = c?.name ?? "Uncategorized";
        return (
          <Pressable key={ch.category_id ?? "none"} onPress={() => open(ch.category_id)} style={styles.child} accessibilityRole="button" accessibilityLabel={`${name} on ${s.name}`}>
            <CategoryIcon name={name} icon={c?.icon} color={c?.color} size={24} />
            <Text style={styles.childName}>{name}</Text>
            {!s.active && s.spent_minor > 0 ? <Text style={styles.share}>{Math.round((ch.spent_minor / s.spent_minor) * 100)}%</Text> : null}
            <Money minor={-ch.spent_minor} currency={s.currency} style={styles.childAmt} />
            <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: C.card, borderRadius: R.card, padding: S.md, gap: 6 },
  compact: { marginBottom: S.xs },
  headRow: { flexDirection: "row", alignItems: "center" },
  head: { flex: 1, flexDirection: "row", alignItems: "center", gap: S.sm },
  trash: { paddingLeft: S.sm, paddingVertical: 4 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#0A84FF", alignItems: "center", justifyContent: "center" },
  name: { fontSize: 17, fontWeight: "600", color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  warn: { fontSize: 12, color: C.orange },
  summary: { gap: 4, paddingVertical: 4 },
  verdict: { flexDirection: "row", alignItems: "center", gap: 6 },
  verdictText: { fontSize: 15, fontWeight: "600" },
  share: { fontSize: 13, color: C.tertiary, fontVariant: ["tabular-nums"] },
  child: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, marginTop: 4 },
  childName: { flex: 1, fontSize: 15, color: C.label },
  childAmt: { fontSize: 15, color: C.secondary },
});
