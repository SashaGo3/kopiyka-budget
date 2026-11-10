import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { formatMinor, listRows, recurringCalendar, shownPaymentIcon, sumInBase, type CalendarPayment } from "@kopiyka/core";
import { useQuery } from "@/store";
import { AmountPill, Row, SectionHeader, Tap } from "@/components/ui";
import { PaymentIcon } from "@/components/PaymentIcon";
import { monthWeeks, weekdays } from "@/components/RangeCalendar";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, monthBounds, shiftMonth, todayLocal } from "@/lib/dates";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { acctName, catName } from "@/lib/names";
import { t } from "@/i18n";

/**
 * The recurring payments as a month: a dot under every day something is paid or expected — green
 * once it has left, orange when its day has passed and nothing has claimed it yet, the tint while it
 * is still to come — and, under the grid, the chosen day's payments. Core `recurringCalendar` says
 * what falls where; a paid occurrence is the row it became, at the amount actually charged.
 */
export function PaymentsCalendar() {
  const today = todayLocal();
  const [month, setMonth] = useState(() => monthBounds(today).start);
  const [picked, setPicked] = useState<string | null>(today);
  const { start, end, label } = monthBounds(month);
  const data = useQuery((db) => ({
    list: recurringCalendar(db, { from: start, to: end, today }),
    accounts: new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a])),
    cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])),
  }), [start, end, today]);
  const byDay = new Map<string, CalendarPayment[]>();
  for (const p of data.list) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  // A day picked in another month means nothing here: show the first day something happens instead.
  const selected = picked && picked >= start && picked < end ? picked : (data.list[0]?.day ?? null);
  const go = (delta: number) => { setMonth(shiftMonth(month, delta)); setPicked(null); };

  const base = useQuery(() => getBaseCurrency());
  const { rateFor } = useRates([...new Set(data.list.map((p) => p.currency))], base);
  const total = (paid: boolean) => sumInBase(data.list.filter((p) => (p.status === "paid") === paid).map((p) => ({ currency: p.currency, minor: p.amount_minor })), base, rateFor).minor;
  const left = total(false), paid = total(true);
  const shown = selected ? byDay.get(selected) ?? [] : [];

  return (
    <>
      <View style={styles.wrap}>
        <View style={styles.head}>
          <Tap onPress={() => go(-1)} hitSlop={10} style={styles.nav} accessibilityRole="button" accessibilityLabel={t("period.calendar.previous")}>
            <SymbolView name="chevron.left" size={16} tintColor={C.tint} />
          </Tap>
          <Text style={styles.month}>{label}</Text>
          <Tap onPress={() => go(1)} hitSlop={10} style={styles.nav} accessibilityRole="button" accessibilityLabel={t("period.calendar.next")}>
            <SymbolView name="chevron.right" size={16} tintColor={C.tint} />
          </Tap>
        </View>
        <View style={styles.week}>{weekdays().map((w, i) => <Text key={i} style={styles.weekday}>{w}</Text>)}</View>
        {monthWeeks(month).map((w, i) => (
          <View key={i} style={styles.week}>
            {w.map((d, j) => {
              if (!d) return <View key={j} style={styles.cell} />;
              const pays = byDay.get(d) ?? [];
              const on = d === selected;
              return (
                <Tap key={j} style={styles.cell} onPress={() => { void Haptics.selectionAsync(); setPicked(d); }} accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={pays.length ? t("settingsLists.recurring.calendar.dayA11y", { day: humanDayTime(d), count: pays.length }) : humanDayTime(d)}>
                  <View style={[styles.dot, on && styles.dotOn, !on && d === today && styles.dotToday]}>
                    <Text style={[styles.dayText, d === today && styles.dayToday, on && styles.dayOn, !pays.length && !on && styles.dayQuiet]}>{Number(d.slice(8, 10))}</Text>
                  </View>
                  <View style={styles.marks}>
                    {pays.slice(0, 3).map((p, k) => <View key={k} style={[styles.mark, { backgroundColor: markColor(p) }]} />)}
                  </View>
                </Tap>
              );
            })}
          </View>
        ))}
        {data.list.length ? (
          <Text style={styles.sum}>
            {t("settingsLists.recurring.calendar.summary", { left: `${formatMinor(left, base)} ${base}`, paid: `${formatMinor(paid, base)} ${base}` })}
          </Text>
        ) : <Text style={styles.sum}>{t("settingsLists.recurring.calendar.emptyMonth")}</Text>}
      </View>
      {selected ? (
        <>
          <SectionHeader>{humanDayTime(selected, null, today, selected.slice(0, 4) !== today.slice(0, 4))}</SectionHeader>
          <View style={styles.list}>
            {shown.length ? shown.map((p, i) => {
              const cat = p.rule.category_id ? data.cats.get(p.rule.category_id) : undefined;
              const title = p.rule.payee || (cat ? catName(cat) : null) || t("settingsLists.recurring.fallbackTitle");
              return (
                <Row key={`${p.rule.id}-${p.transaction_id ?? p.day}`} title={title}
                  left={<PaymentIcon icon={shownPaymentIcon(p.rule)} category={cat ? { name: catName(cat), icon: cat.icon, color: cat.color } : null} size={26} />}
                  subtitle={`${t(`settingsLists.recurring.calendar.${p.status}`)} · ${acctName(data.accounts.get(p.rule.account_id)) ?? ""}`}
                  subtitleColor={markColor(p)}
                  right={<AmountPill minor={p.amount_minor} currency={p.currency} neutral={p.status !== "paid"} />}
                  onPress={() => router.push(p.transaction_id ? { pathname: "/transaction/[id]", params: { id: p.transaction_id } } : { pathname: "/recurring/[id]", params: { id: p.rule.id } })}
                  style={i ? styles.divider : undefined} />
              );
            }) : <Text style={styles.none}>{t("settingsLists.recurring.calendar.emptyDay")}</Text>}
          </View>
        </>
      ) : null}
    </>
  );
}

function markColor(p: CalendarPayment) {
  return p.status === "paid" ? C.green : p.status === "late" ? C.orange : C.tint;
}

const styles = themed(() => StyleSheet.create({
  wrap: { marginHorizontal: S.lg, marginTop: S.sm, backgroundColor: C.card, borderRadius: 16, paddingHorizontal: S.sm, paddingVertical: S.md, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.sm, paddingBottom: S.sm },
  nav: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: C.fill },
  month: { fontSize: 17, fontWeight: "600", color: C.label },
  week: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600", color: C.tertiary, paddingBottom: 4 },
  cell: { flex: 1, height: 50, alignItems: "center", paddingTop: 3 },
  dot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dotOn: { backgroundColor: C.tint },
  dotToday: { borderWidth: 1.5, borderColor: C.tint },
  dayText: { fontSize: 17, color: C.label, fontVariant: ["tabular-nums"] },
  dayQuiet: { color: C.secondary },
  dayToday: { color: C.tint, fontWeight: "700" },
  dayOn: { color: C.onTint, fontWeight: "700" },
  marks: { flexDirection: "row", gap: 3, height: 6, marginTop: 3 },
  mark: { width: 5, height: 5, borderRadius: 2.5 },
  sum: { fontSize: 13, color: C.secondary, textAlign: "center", paddingTop: S.sm, paddingHorizontal: S.sm },
  list: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 16, overflow: "hidden" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  none: { fontSize: 15, color: C.secondary, padding: S.lg },
}));
