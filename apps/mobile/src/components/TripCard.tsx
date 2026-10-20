import { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatMinor, getRow, tripKind, tripStats, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { useQuery } from "@/store";
import { AmountPill, CategoryIcon, Money, ProgressBar } from "@/components/ui";
import { C, R, S, themed, themeHue, themeTone } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { useRates } from "@/lib/rates";
import { catName } from "@/lib/names";
import { tripLook, tripName } from "@/lib/travel";
import { t } from "@/i18n";

/**
 * A trip (travel mode budget). Ignores the account scope: a trip is paid from anywhere. Tapping the
 * head opens Transactions filtered by the trip tag, or `onPress` when given. `onShow` replaces that
 * opening for the head and the category lines alike — Transactions passes it when the list is already
 * this trip, so a tap narrows the list in place instead of pushing the same list again on top of it.
 *
 * Kept to what matters while travelling: the name and the day, one big number — what is left per
 * day, or how far over it is — the bar, and one line of spent against the budget. Payments chosen to
 * stay outside the budget (`outside_ids`) are named on that line; the categories fold away. Changing
 * anything is Settings → Travel's job (`settings/trip.tsx`), never the card's.
 *
 * Once the trip is over the full card is its summary: how it came out against the plan and the pace
 * per day against the pace planned, with each category's share when unfolded.
 *
 * A trip with no limit (core `tripLimited`) has no plan to measure against, so it has no bar, no
 * "left" and no verdict: the number is what was spent, and the pace is what the days cost.
 */
export function TripCard({ budget, compact, onPress, onShow }: { budget: Budget; compact?: boolean; onPress?: () => void; onShow?: (category?: string | null) => void }) {
  const currencies = useQuery((d) => d.all<{ c: string }>(`SELECT DISTINCT currency AS c FROM accounts WHERE deleted=0`).map((r) => r.c));
  const { rateFor } = useRates(currencies, budget.currency);
  const today = useQuery(() => todayLocal());
  const [open, setOpen] = useState(false);
  // Recomputed on every render: a couple of tiny queries, and `rateFor` changes once rates arrive.
  const s = tripStats(db, budget, { rateFor, today });
  const tripTitle = tripName(s);
  const kind = tripKind(budget);
  const look = tripLook(kind);
  const ratio = s.limit_minor > 0 ? Math.min(1, s.spent_minor / s.limit_minor) : 0;
  const show = (category?: string | null) => onShow ? onShow(category) : router.push({ pathname: "/transactions", params: { tag: budget.tag_id ?? "", name: tripTitle, ...(category !== undefined ? { category: category ?? "none" } : {}), from: "0000", nonce: String(Date.now()) } });
  const cats = new Map(s.by_category.map((c) => [c.category_id, c.category_id ? getRow(db, "categories", c.category_id) : null]));
  // Set up ahead: nothing is counting yet, so the card says when it begins rather than "Day 1".
  const when = s.active && budget.starts > today ? t("travel.card.startsOn", { date: humanDayTime(budget.starts) })
    : s.active
    ? (s.days_left ? t("travel.card.dayOf", { day: s.day, days: s.days }) : t("travel.card.dayPlanned", { day: s.day, date: humanDayTime(budget.ends ?? budget.starts) }))
    : t("travel.card.span", { from: humanDayTime(budget.starts, null, undefined, true), to: humanDayTime(budget.ended ?? budget.ends ?? budget.starts, null, undefined, true), count: s.days });
  const fmt = (m: number) => formatMinor(m, s.currency);
  const over = s.remaining_minor < 0;
  // The one number worth a glance while away: what each day may still cost, or that it is gone.
  const hero = !s.active || compact ? null
    : !s.limited ? { value: `${fmt(s.spent_minor)} ${s.currency}`, label: t("travel.card.spentSoFar"), color: C.label }
    : over ? { value: `${fmt(-s.remaining_minor)} ${s.currency}`, label: t("travel.card.over"), color: C.orange }
    : s.allowance_minor !== null ? { value: `${fmt(s.allowance_minor)} ${s.currency}`, label: s.days_left === 1 ? t("travel.card.leftToday") : t("travel.card.perDayLeft", { count: s.days_left ?? 0 }), color: C.label }
    : null;
  const line = [s.limited ? t("travel.card.spent", { spent: fmt(s.spent_minor), limit: fmt(s.limit_minor), currency: s.currency }) : t("travel.card.spentNoLimit", { spent: fmt(s.spent_minor), currency: s.currency }), s.outside_minor ? t("travel.card.outside", { amount: fmt(s.outside_minor) }) : ""].filter(Boolean).join(" · ");
  const plannedPerDay = Math.round(s.limit_minor / s.days);
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <Pressable onPress={onPress ?? (() => show())} style={styles.head} accessibilityRole="button" accessibilityLabel={s.limited ? t("travel.card.label", { kind, name: tripTitle, amount: `${fmt(s.remaining_minor)} ${s.currency}` }) : t("travel.card.labelSpent", { kind, name: tripTitle, amount: `${fmt(s.spent_minor)} ${s.currency}` })}>
        <View style={[styles.icon, { backgroundColor: themeHue(look.color) }]}><SymbolView name={look.icon} size={18} tintColor={themeTone(look.color).glyph} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{tripTitle}</Text>
          <Text style={styles.sub}>{when}</Text>
        </View>
        {hero ? null : s.limited ? <AmountPill minor={s.remaining_minor} currency={s.currency} warn /> : <AmountPill minor={s.spent_minor} currency={s.currency} neutral />}
      </Pressable>
      {hero ? (
        <View style={styles.hero} accessible accessibilityLabel={`${hero.value} ${hero.label}`}>
          <Text style={[styles.heroValue, { color: hero.color }]} numberOfLines={1} adjustsFontSizeToFit>{hero.value}</Text>
          <Text style={styles.heroLabel}>{hero.label}</Text>
        </View>
      ) : null}
      {s.limited ? <ProgressBar ratio={ratio} color={over || ratio > 0.85 ? C.orange : themeHue(look.color)} /> : null}
      <Text style={styles.sub}>{line}</Text>
      {!compact && !s.active && !s.limited && s.days > 1 ? <Text style={styles.sub}>{t("travel.card.paceOnly", { amount: `${fmt(s.per_day_minor)} ${s.currency}` })}</Text> : null}
      {!compact && !s.active && s.limited ? (
        <View style={styles.verdict}>
          <SymbolView name={s.over ? "exclamationmark.circle.fill" : "party.popper.fill"} size={18} tintColor={s.over ? C.orange : C.green} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.verdictText, { color: s.over ? C.orange : C.green }]}>
              {s.over ? t("travel.card.overPlan", { amount: `${fmt(-s.remaining_minor)} ${s.currency}` }) : s.remaining_minor ? t("travel.card.leftOfPlan", { amount: `${fmt(s.remaining_minor)} ${s.currency}` }) : t("travel.card.exact")}
            </Text>
            {s.days > 1 ? <Text style={styles.sub}>{t("travel.card.pace", { amount: `${fmt(s.per_day_minor)} ${s.currency}`, planned: fmt(plannedPerDay) })}</Text> : null}
          </View>
        </View>
      ) : null}
      {s.unconverted.length ? <Text style={styles.warn}>{t("travel.card.unconverted", { amounts: s.unconverted.map((u) => `${formatMinor(u.minor, u.currency)} ${u.currency}`).join(", ") })}</Text> : null}
      {!compact && s.by_category.length ? (
        <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((v) => !v); }} style={styles.fold}
          accessibilityRole="button" accessibilityLabel={open ? t("travel.card.hideSpent") : t("travel.card.showSpent")} accessibilityState={{ expanded: open }}>
          <Text style={[styles.sub, { flex: 1 }]}>{t("travel.card.byCategory")}</Text>
          <SymbolView name={open ? "chevron.up" : "chevron.down"} size={13} tintColor={C.secondary} />
        </Pressable>
      ) : null}
      {!compact && open && s.by_category.map((ch) => {
        const c = cats.get(ch.category_id);
        const name = c ? catName(c) : t("budgets.title.uncategorized");
        return (
          <Pressable key={ch.category_id ?? "none"} onPress={() => show(ch.category_id)} style={styles.child} accessibilityRole="button" accessibilityLabel={t("travel.card.categoryLabel", { name, trip: tripTitle })}>
            <CategoryIcon name={name} icon={c?.icon} color={c?.color} size={24} />
            <Text style={styles.childName}>{name}</Text>
            {s.spent_minor > 0 ? <Text style={styles.share}>{Math.round((ch.spent_minor / s.spent_minor) * 100)}%</Text> : null}
            <Money minor={-ch.spent_minor} currency={s.currency} style={styles.childAmt} />
            <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: C.card, borderRadius: R.card, padding: S.md, gap: 6 },
  compact: { marginBottom: S.xs },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 17, fontWeight: "600", color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  warn: { fontSize: 12, color: C.orange },
  hero: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  heroValue: { fontSize: 28, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  heroLabel: { fontSize: 15, color: C.secondary, flexShrink: 1 },
  fold: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 36, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, marginTop: 2 },
  verdict: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  verdictText: { fontSize: 15, fontWeight: "600" },
  share: { fontSize: 13, color: C.tertiary, fontVariant: ["tabular-nums"] },
  child: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, marginTop: 4 },
  childName: { flex: 1, fontSize: 15, color: C.label },
  childAmt: { fontSize: 15, color: C.secondary },
}));
