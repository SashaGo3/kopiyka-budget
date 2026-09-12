import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatMinor, getRow, tripStats, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { useQuery } from "@/store";
import { AmountPill, CategoryIcon, Money, ProgressBar } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { useRates } from "@/lib/rates";

/**
 * A trip (travel mode budget): remaining, progress, day counter and the daily allowance,
 * then the split by category. Ignores the account scope: a trip is paid from anywhere.
 * Tapping the head opens Transactions filtered by the trip tag.
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
  const pace = s.allowance_minor !== null ? `${fmt(s.per_day_minor)}/day so far · ${fmt(Math.max(0, s.allowance_minor))}/day left` : `${fmt(s.per_day_minor)}/day`;
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.headRow}>
        <Pressable onPress={() => open()} style={styles.head} accessibilityRole="button" accessibilityLabel={`Trip ${s.name}, ${fmt(s.remaining_minor)} ${s.currency} left`}>
          <View style={styles.icon}><SymbolView name="airplane" size={18} tintColor="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.sub}>{when}</Text>
          </View>
          <AmountPill minor={s.remaining_minor} currency={s.currency} />
        </Pressable>
        {compact && onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8} style={styles.trash} accessibilityRole="button" accessibilityLabel={`Remove trip ${s.name}`}>
            <SymbolView name="trash" size={16} tintColor={C.red} />
          </Pressable>
        ) : null}
      </View>
      <ProgressBar ratio={ratio} color={s.over ? C.red : ratio > 0.85 ? C.orange : "#0A84FF"} />
      <Text style={styles.sub}>{fmt(s.spent_minor)} of {fmt(s.limit_minor)} {s.currency}{compact ? "" : ` · ${pace}`}</Text>
      {s.unconverted.length ? <Text style={styles.warn}>Not counted (no exchange rate yet): {s.unconverted.map((u) => `${formatMinor(u.minor, u.currency)} ${u.currency}`).join(", ")}</Text> : null}
      {!compact && s.by_category.map((ch) => {
        const c = cats.get(ch.category_id);
        const name = c?.name ?? "Uncategorized";
        return (
          <Pressable key={ch.category_id ?? "none"} onPress={() => open(ch.category_id)} style={styles.child} accessibilityRole="button" accessibilityLabel={`${name} on ${s.name}`}>
            <CategoryIcon name={name} icon={c?.icon} color={c?.color} size={24} />
            <Text style={styles.childName}>{name}</Text>
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
  child: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, marginTop: 4 },
  childName: { flex: 1, fontSize: 15, color: C.label },
  childAmt: { fontSize: 15, color: C.secondary },
});
