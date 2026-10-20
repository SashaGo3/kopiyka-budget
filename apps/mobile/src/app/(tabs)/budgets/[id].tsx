import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { budgetCategoryIds, budgetRow, budgetSeries, daysUntil, formatMinor, getRow, listRows, type Budget, type Category, type Tag } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { ButtonText, Card, CategoryIcon, CategoryIconStack, Empty, Money, ProgressBar, Row, SectionHeader } from "@/components/ui";
import { HistoryChart } from "@/components/HistoryChart";
import { PeriodPill } from "@/components/PeriodPill";
import { C, S, themed } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { anchorDay, currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBudgetScope } from "@/lib/settings";
import { scopeAccountIds } from "@/lib/scope";
import { budgetLook } from "@/lib/budgetName";
import { catName } from "@/lib/names";
import { t } from "@/i18n";

type Line = { id: string | null; name: string; spent: number; icon: string | null; color: string | null };

/**
 * One budget opened from its card on Budgets. What the card has no room for: what is left of it and
 * how fast it may go for the rest of the period, the categories it was spent on, and how it went
 * period by period — the bars against its limit, the average, how often it was kept. The period is
 * the shared one (Budgets and Transactions move with it). Changing the budget is Edit in the header.
 */
export default function BudgetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const budget = useQuery((d) => (getRow(d, "budgets", id) as Budget | undefined) ?? null, [id]);
  const [period, setPeriod] = usePeriod();
  const monthKey = useMemo(() => newPickKey("bmonth"), []);
  usePickResult<string>(monthKey, useCallback((d: string) => setPeriod(periodContaining(`${d.slice(0, 8)}${String(Math.min(getPeriodStartDay(), 28)).padStart(2, "0")}`)), [setPeriod]));
  const startDay = useQuery(() => getPeriodStartDay());
  const scope = useQuery(() => getBudgetScope());
  const accountIds = useQuery((d) => scopeAccountIds(scope, listRows(d, "accounts", "deleted=0")), [scope]);
  const day = anchorDay(period);
  const today = useQuery(() => todayLocal());

  const data = useQuery((d) => {
    if (!budget || budget.deleted) return null;
    const cats = new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c as Category]));
    const tags = new Map(listRows(d, "tags", "1=1").map((x) => [x.id, x as Tag]));
    const scoped = accountIds.length ? accountIds : undefined;
    const row = budgetRow(d, budget, { start: period.start, end: period.end, accountIds: scoped });
    // A scoped budget breaks down by the categories that were actually spent in; an overall one by
    // folder, because otherwise the list is every category you own — as the card used to, folded.
    const ids = budgetCategoryIds(budget);
    const one = ids.length === 1 ? cats.get(ids[0]!) : undefined;
    const merged = new Map<string, Line>();
    const lineOf = (sc: Category | undefined): Line => {
      const top = sc?.parent_id ? cats.get(sc.parent_id) : sc;
      const ref = ids.length ? sc : top;
      const name = ids.length
        ? (one && sc?.id === one.id ? t("budgets.direct") : sc ? catName(sc) : t("budgets.title.uncategorized"))
        : top ? catName(top) : t("budgets.title.uncategorized");
      return { id: ref?.id ?? null, name, spent: 0, icon: ref?.icon ?? null, color: ref?.color ?? null };
    };
    for (const ch of row.children) {
      const line = lineOf(ch.category_id ? cats.get(ch.category_id) : undefined);
      const e = merged.get(line.id ?? "none") ?? line;
      e.spent += ch.spent_minor; merged.set(line.id ?? "none", e);
    }
    // A scoped budget lists every category it covers, the ones nothing was spent on yet included:
    // a folder by the categories inside it (live, still offered), anything else as itself.
    for (const cid of ids) {
      const c = cats.get(cid);
      if (!c || c.deleted) continue;
      const inside = [...cats.values()].filter((x) => x.parent_id === cid && !x.deleted);
      for (const x of inside.length ? inside.filter((x) => !x.archived) : [c]) if (!merged.has(x.id)) merged.set(x.id, lineOf(x));
    }
    return {
      look: budgetLook(budget, cats, tags), spent: row.spent_minor,
      lines: [...merged.values()].sort((a, z) => z.spent - a.spent),
      history: budgetSeries(d, budget, { accountIds: scoped, startDay, today: day }),
    };
  }, [budget, period.start, accountIds.join(","), startDay, day]);

  if (!budget || budget.deleted || !data) return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <Empty title={t("budgets.detail.goneTitle")} hint={t("budgets.detail.goneHint")} action={{ label: t("common.back"), onPress: () => router.back() }} />
    </>
  );

  const { look, spent, lines, history } = data;
  const limit = budget.amount_minor, currency = budget.currency;
  const left = limit - spent;
  const ratio = limit > 0 ? spent / limit : 0;
  const pn = period.subtitle ?? period.title;
  // Only the period running now has days still to come; a past one has a verdict instead.
  const isNow = period.start <= today && today < period.end;
  const daysLeft = isNow ? Math.max(1, daysUntil(today, period.end)) : 0;
  const amt = (minor: number) => `${formatMinor(minor, currency)} ${currency}`;
  // Complete periods only, measured against the limit it has now: a limit changed last spring is not
  // remembered anywhere, so the hint under the row says which limit the count is against.
  const done = history ? history.points.filter((p) => !p.current) : [];
  const kept = done.filter((p) => p.minor <= limit).length;
  /** The transactions a line is made of; a tag budget's line is that category *while carrying the tag*. */
  const open = (line: Line) => router.push({ pathname: "/transactions", params: { category: line.id ?? "none", name: budget.tag_id ? `${look.name} · ${line.name}` : line.name,
    ...(budget.tag_id ? { tag: budget.tag_id } : {}), from: period.start, to: period.end, accounts: accountIds.join(","), nonce: String(Date.now()) } });

  return (
    <>
      <Stack.Screen options={{ title: look.name, headerLargeTitle: false,
        headerRight: () => (
          <Pressable onPress={() => router.push({ pathname: "/budget/edit", params: { id: budget.id } })} hitSlop={10} style={styles.headerText} accessibilityRole="button" accessibilityLabel={t("common.edit")}>
            <ButtonText style={styles.headerLink} maxFontSizeMultiplier={1.3}>{t("common.edit")}</ButtonText>
          </Pressable>
        ) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120, paddingTop: S.sm, gap: S.md }}>
        <View style={styles.pills}>
          <PeriodPill period={period} onPrev={() => setPeriod(shiftPeriod(period, -1))} onNext={() => setPeriod(shiftPeriod(period, 1))} onReset={() => setPeriod(currentPeriod())}
            onPick={() => router.push({ pathname: "/pick/month", params: { key: monthKey, selected: period.start, now: currentPeriod().start } })} />
        </View>
        <View style={styles.card}>
          <View style={styles.head}>
            {look.icons.length > 1 ? <CategoryIconStack items={look.icons} size={34} /> : <CategoryIcon name={look.name} icon={look.icon} color={look.color} size={34} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>{look.parent ? `${look.parent} › ` : ""}{look.name}</Text>
              <Text style={styles.sub}>{t("budgets.spentOf", { spent: formatMinor(spent, currency), limit: formatMinor(limit, currency), currency })}{budget.in_planned ? "" : ` · ${t("budgets.notInPlanned")}`}</Text>
            </View>
          </View>
          <Money minor={Math.abs(left)} currency={currency} style={[styles.big, left < 0 && { color: C.orange }]} />
          <Text style={styles.sub}>{left < 0 ? t("budgets.detail.over", { period: pn }) : t("budgets.detail.left", { period: pn })}</Text>
          <ProgressBar ratio={Math.min(1, ratio)} color={ratio > 1 || ratio > 0.85 ? C.orange : C.green} height={8} />
          {isNow && left > 0 ? <Text style={styles.line}>{t("budgets.detail.perDay", { amount: amt(Math.floor(left / daysLeft)), count: daysLeft })}</Text> : null}
        </View>

        <View>
          <SectionHeader>{t("budgets.detail.spentOn", { period: pn })}</SectionHeader>
          {lines.length ? (
            <Card>
              {lines.map((l, i) => (
                <Row key={l.id ?? "none"} title={l.name} left={<CategoryIcon name={l.name} icon={l.icon} color={l.color} size={28} />}
                  right={<Money minor={-l.spent} currency={currency} style={styles.amount} />} style={i > 0 ? styles.divider : undefined} onPress={() => open(l)} />
              ))}
            </Card>
          ) : <Text style={styles.hint}>{t("budgets.detail.nothing", { period: pn })}</Text>}
        </View>

        {history ? (
          <View>
            <SectionHeader>{t("budgets.detail.history", { currency })}</SectionHeader>
            <HistoryChart series={history} color={C.green} limit={limit} />
          </View>
        ) : null}
        {done.length ? (
          <View>
            <Card>
              <Row title={t("budgets.detail.kept")} right={<Text style={styles.amount}>{t("budgets.detail.keptValue", { kept, count: done.length })}</Text>} />
            </Card>
            <Text style={styles.hint}>{t("budgets.detail.keptHint", { limit: amt(limit) })}</Text>
          </View>
        ) : null}
        {!history ? (
          <View style={styles.empty}>
            <SymbolView name="chart.bar" size={20} tintColor={C.tertiary} />
            <Text style={[styles.hint, { marginTop: 0, paddingHorizontal: 0, flex: 1 }]}>{t("budgets.detail.noHistory")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  pills: { flexDirection: "row", paddingHorizontal: S.lg },
  card: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 16, padding: S.lg, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm, marginBottom: S.xs },
  name: { fontSize: 17, fontWeight: "600", color: C.label },
  big: { fontSize: 30, fontWeight: "700", color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  line: { fontSize: 15, color: C.label, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "600", color: C.label, fontVariant: ["tabular-nums"] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.secondary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
  empty: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.xl },
  headerText: { paddingHorizontal: 12, paddingVertical: 6 },
  headerLink: { color: C.tint, fontSize: 17 },
}));
