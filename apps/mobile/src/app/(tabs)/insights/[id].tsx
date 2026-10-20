import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  accountBalanceMinor, accountHistory, budgetRows, categoryChecklist, categoryImportance, checklistTotals, commitments, formatMinor, getRow, incomeSeries, incomeSources, listRows, parseInsightParams, regularSeries,
  retiredKind, safetyBuffer, savingsGoal, shownPaymentIcon, spendSeries, subscriptionsPerYear, toSeries, type Category, type Insight, type Series,
} from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { ButtonText, Card, Empty, Money, ProgressBar, Row, SectionHeader } from "@/components/ui";
import { InsightCard } from "@/components/InsightCard";
import { HistoryChart } from "@/components/HistoryChart";
import { PeriodPill } from "@/components/PeriodPill";
import { PaymentIcon } from "@/components/PaymentIcon";
import { C, S, themed, themeHue } from "@/constants/theme";
import { humanDayTime, monthLong, todayLocal } from "@/lib/dates";
import { anchorDay, currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBudgetScope } from "@/lib/settings";
import { scopeAccount, scopeAccountIds } from "@/lib/scope";
import { budgetTitle, nameMaps } from "@/lib/budgetName";
import { INSIGHT_LOOK, kindTitle, perPeriod, ruleTitle } from "@/lib/insights";
import { acctName, catName } from "@/lib/names";
import { t } from "@/i18n";

/**
 * One insight opened. The card is at the top, as it is on the Insights tab, and under it everything
 * behind its number — what a glance at the card cannot hold. Edit is in the header; the month is
 * stepped with the arrows or picked from the pill, and moves the card and every history with it.
 *
 * Each kind has its own sections, chosen for the question the card is there to answer:
 * - Budgets left: each budget's state, what is still to be charged before payday, spending by period.
 * - Days to salary: income period by period (the average, the lowest, the highest), where this
 *   period's came from, and how far what is left goes.
 * - Savings goal and Account: the balance month by month, what went in and out, and the pace.
 * - Payments checklist: every line, the ones already done included, what is paid and still to pay, and what its categories cost.
 * - Subscriptions: every recurring payment, counted and not, per month and per year.
 * - Regular spending: its own windows — per week for a weekly card — so the averages are the card's.
 * - What it went on: spending by period beside the split.
 * - Safety buffer: the accounts counted, and what a month of the comfort level has cost.
 */
export default function InsightDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insight = useQuery((d) => (getRow(d, "insights", id) as Insight | undefined) ?? null, [id]);
  const [period, setPeriod] = usePeriod();
  const monthKey = useMemo(() => newPickKey("dmonth"), []);
  usePickResult<string>(monthKey, useCallback((d: string) => setPeriod(periodContaining(`${d.slice(0, 8)}${String(Math.min(getPeriodStartDay(), 28)).padStart(2, "0")}`)), [setPeriod]));
  const p = insight ? parseInsightParams(insight.params) : {};
  const kind = insight ? retiredKind(insight.kind) : null;
  const title = insight ? p.title || kindTitle(kind ?? insight.kind) : "";
  const hue = kind ? themeHue(INSIGHT_LOOK[kind]?.color ?? "#007AFF") : C.tint;

  if (!insight || insight.deleted || !kind) return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <Empty title={t("insights.detail.goneTitle")} hint={t("insights.detail.goneHint")} action={{ label: t("common.back"), onPress: () => router.back() }} />
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitle: false,
        headerRight: () => (
          <Pressable onPress={() => router.push({ pathname: "/insight/edit", params: { id: insight.id } })} hitSlop={10} style={styles.headerText} accessibilityRole="button" accessibilityLabel={t("insights.detail.edit")}>
            <ButtonText style={styles.headerLink} maxFontSizeMultiplier={1.3}>{t("insights.detail.edit")}</ButtonText>
          </Pressable>
        ) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120, paddingTop: S.sm, gap: S.md }}>
        <View style={styles.pills}>
          <PeriodPill period={period} onPrev={() => setPeriod(shiftPeriod(period, -1))} onNext={() => setPeriod(shiftPeriod(period, 1))} onReset={() => setPeriod(currentPeriod())}
            onPick={() => router.push({ pathname: "/pick/month", params: { key: monthKey, selected: period.start, now: currentPeriod().start } })} />
        </View>
        <InsightCard insight={insight} detail />
        <Details insight={insight} hue={hue} />
      </ScrollView>
    </>
  );
}

/** A titled block of the details: a section header and what goes under it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <SectionHeader>{title}</SectionHeader>
      {children}
    </View>
  );
}

/**
 * The history chart, one currency at a time: arrows in the header step between them when money moved
 * in more than one, rather than a stack of near-identical charts down the screen.
 */
function Histories({ series, title, hue, weekly, kind, empty }: { series: Series[]; title: (currency: string) => string; hue: ColorValue; weekly?: boolean; kind?: "spend" | "income" | "balance"; empty?: string }) {
  const [at, setAt] = useState(0);
  if (!series.length) return empty ? <Text style={styles.hint}>{empty}</Text> : null;
  const i = Math.min(at, series.length - 1), s = series[i]!;
  const arrow = (dir: -1 | 1) => {
    const to = series[i + dir];
    return (
      <Pressable onPress={() => { if (to) setAt(i + dir); }} disabled={!to} hitSlop={10} style={[styles.arrow, !to && { opacity: 0.3 }]}
        accessibilityRole="button" accessibilityLabel={to ? t("insights.detail.showCurrency", { currency: to.currency }) : undefined} accessibilityElementsHidden={!to}>
        <SymbolView name={dir < 0 ? "chevron.left" : "chevron.right"} size={15} weight="semibold" tintColor={C.tint} />
      </Pressable>
    );
  };
  return (
    <View>
      <SectionHeader right={series.length > 1 ? <View style={styles.arrows}>{arrow(-1)}<Text style={styles.arrowCount}>{i + 1}/{series.length}</Text>{arrow(1)}</View> : undefined}>{title(s.currency)}</SectionHeader>
      <HistoryChart key={s.currency} series={s} color={hue} weekly={weekly} kind={kind} />
    </View>
  );
}

function Details({ insight, hue }: { insight: Insight; hue: ColorValue }) {
  const p = parseInsightParams(insight.params);
  const kind = retiredKind(insight.kind);
  const [period] = usePeriod();
  const day = anchorDay(period);
  const startDay = useQuery(() => getPeriodStartDay());
  const scope = useQuery(() => getBudgetScope());
  const accountIds = useQuery((d) => scopeAccountIds(scope, listRows(d, "accounts", "deleted=0")), [scope]);
  const scoped = accountIds.length ? accountIds : undefined;
  const isNow = period.start === currentPeriod(startDay).start;
  const pn = period.subtitle ?? period.title;
  const spendTitle = (currency: string) => t("insights.detail.history", { currency });
  const amt = (minor: number, currency: string) => `${formatMinor(minor, currency)} ${currency}`;
  const money = (minor: number, currency: string, color?: ColorValue) => <Money minor={minor} currency={currency} style={[styles.amount, color ? { color } : null]} />;

  const data = useQuery((d) => {
    switch (kind) {
      case "free_money": {
        const names = nameMaps(d);
        const rows = budgetRows(d, { start: period.start, end: period.end, accountIds: scoped, budgetAccount: scopeAccount(scope) })
          .map((r) => ({ id: r.budget.id, name: budgetTitle(r.budget, names), currency: r.budget.currency, limit: r.budget.amount_minor, spent: r.spent_minor, counted: r.budget.in_planned !== 0 }));
        const coming = isNow ? commitments(d, { start: todayLocal(), end: period.end, accountIds: scoped }).sort((a, b) => a.day.localeCompare(b.day)) : [];
        return { kind, rows, coming, history: spendSeries(d, { categoryIds: [], accountIds: scoped, startDay, today: day }) };
      }
      case "days_to_salary":
        return { kind, income: incomeSeries(d, { accountIds: scoped, startDay, today: day }), sources: incomeSources(d, { start: period.start, end: period.end, accountIds: scoped }),
          cats: new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c])) };
      case "savings_goal":
      case "account_balance": {
        const goal = kind === "savings_goal" ? savingsGoal(d, p) : null;
        const h = p.account_id ? accountHistory(d, p.account_id, { startDay, today: day }) : null;
        return { kind, goal, h, name: p.account_id ? acctName(getRow(d, "accounts", p.account_id)) : "" };
      }
      case "checklist":
        return { kind, totals: checklistTotals(categoryChecklist(d, p, { start: period.start, end: period.end, accountIds: scoped })),
          history: p.category_ids?.length ? spendSeries(d, { categoryIds: p.category_ids, accountIds: scoped, startDay, today: day }) : [] };
      case "subscriptions": {
        const v = subscriptionsPerYear(d, p);
        return { kind, v, cats: new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c])) };
      }
      case "regular":
        return { kind, series: regularSeries(d, p, { today: day, accountIds: scoped }), weekly: p.frequency === "weekly" };
      case "values":
        return { kind, history: spendSeries(d, { categoryIds: [], accountIds: scoped, startDay, today: day }) };
      case "safety_buffer": {
        const b = safetyBuffer(d, p, { today: day, startDay });
        if (!b) return { kind, b, accounts: [], history: [] };
        // The comfort level's own categories, or the ones marked most important: what the card divides by.
        const cats = listRows(d, "categories", "deleted=0") as Category[];
        const level = categoryImportance(cats);
        const ids = b.basis === "chosen" ? p.category_ids ?? [] : cats.filter((c) => level.get(c.id) === 3).map((c) => c.id);
        const history = ids.length ? spendSeries(d, { categoryIds: ids, startDay, today: day }).filter((s) => s.currency === b.currency) : [];
        const accounts = b.account_ids.map((aid) => getRow(d, "accounts", aid)).filter((a): a is NonNullable<typeof a> => !!a);
        return { kind, b, accounts, history };
      }
      default: return { kind: "none" as const };
    }
  }, [insight.params, kind, period.start, day, scope, startDay, accountIds.join(",")]);

  switch (data.kind) {
    case "free_money": {
      const rows = data.rows;
      return <>
        {rows.length ? (
          <Section title={t("insights.detail.budgets", { period: pn })}>
            <Card>
              {rows.map((r, i) => {
                const left = r.limit - r.spent, ratio = r.limit > 0 ? r.spent / r.limit : 0;
                return (
                  <Pressable key={r.id} onPress={() => router.push({ pathname: "/budget/edit", params: { id: r.id } })} style={({ pressed }) => [styles.budgetRow, i > 0 && styles.divider, pressed && { backgroundColor: C.fill }]}
                    accessibilityRole="button" accessibilityLabel={`${r.name}, ${left >= 0 ? t("insights.detail.left", { amount: amt(left, r.currency) }) : t("insights.detail.over", { amount: amt(-left, r.currency) })}`}>
                    <View style={styles.budgetTop}>
                      <Text style={styles.rowName}>{r.name}</Text>
                      {money(left, r.currency, left < 0 ? C.red : C.green)}
                    </View>
                    <ProgressBar ratio={Math.min(1, ratio)} color={ratio > 1 ? C.red : ratio > 0.85 ? C.orange : C.green} />
                    <Text style={styles.rowSub}>{t("insights.detail.spentOf", { spent: amt(r.spent, r.currency), limit: amt(r.limit, r.currency) })}{r.counted ? "" : ` · ${t("budgets.notInPlanned")}`}</Text>
                  </Pressable>
                );
              })}
            </Card>
          </Section>
        ) : null}
        {data.coming.length ? (
          <Section title={t("insights.detail.coming", { day: humanDayTime(period.end) })}>
            <Card>
              {data.coming.map((c, i) => (
                <Row key={`${c.kind}:${c.id}:${c.day}`} title={c.title} subtitle={humanDayTime(c.day)} right={money(-c.minor, c.currency)} style={i > 0 ? styles.divider : undefined}
                  onPress={() => router.push(c.kind === "rule" ? { pathname: "/recurring/[id]", params: { id: c.id } } : { pathname: "/debt/edit", params: { id: c.id } })} />
              ))}
            </Card>
          </Section>
        ) : null}
        <Histories series={data.history} title={spendTitle} hue={hue} empty={t("insights.detail.noHistory")} />
      </>;
    }
    case "days_to_salary": {
      const total = new Map<string, number>();
      for (const s of data.sources) total.set(s.currency, (total.get(s.currency) ?? 0) + s.minor);
      return <>
        <Histories series={data.income} title={(currency) => t("insights.detail.income", { currency })} hue={C.green} kind="income" empty={t("insights.detail.noIncome")} />
        {data.sources.length ? (
          <Section title={t("insights.detail.incomeFrom", { period: pn })}>
            <Card>
              {data.sources.slice(0, 12).map((s, i) => {
                const cat = s.category_id ? data.cats.get(s.category_id) : undefined;
                const name = s.payee || (cat ? catName(cat) : t("common.noCategory"));
                const share = total.get(s.currency) ? Math.round((s.minor / total.get(s.currency)!) * 100) : 0;
                return <Row key={`${s.category_id}:${s.payee}:${s.currency}`} title={name} subtitle={[s.payee && cat ? catName(cat) : null, s.n > 1 ? t("insights.detail.times", { count: s.n }) : null, `${share}%`].filter(Boolean).join(" · ")}
                  right={money(s.minor, s.currency, C.green)} style={i > 0 ? styles.divider : undefined} />;
              })}
            </Card>
          </Section>
        ) : null}
      </>;
    }
    case "savings_goal":
    case "account_balance": {
      const h = data.h;
      if (!h || !h.periods.length) return <Text style={styles.hint}>{t("insights.detail.noMoves")}</Text>;
      const balance = toSeries(h.currency, h.periods.map((x) => ({ start: x.start, end: x.end, minor: x.balance_minor, current: x.current })));
      const done = h.periods.filter((x) => !x.current);
      const pace = done.length ? Math.round(done.reduce((a, x) => a + x.net_minor, 0) / done.length) : null;
      const goal = data.goal;
      const toGo = goal ? goal.target - goal.balance : 0;
      // Months still needed at the average pace, as the month it lands in; nothing to say when the
      // pace is not taking the balance towards the goal at all.
      const eta = goal && toGo > 0 && pace && pace > 0 ? (() => {
        const months = Math.ceil(toGo / pace);
        const [y, m] = todayLocal().split("-").map(Number) as [number, number];
        const at = new Date(Date.UTC(y, m - 1 + months, 1));
        return { months, label: `${monthLong(at.getUTCMonth() + 1)} ${at.getUTCFullYear()}` };
      })() : null;
      return <>
        {goal || pace !== null ? (
          <Section title={goal ? t("insights.detail.goal") : t("insights.detail.pace")}>
            <Card>
              {goal ? <Row title={t("insights.detail.target")} right={money(goal.target, goal.currency)} /> : null}
              {goal ? <Row title={toGo > 0 ? t("insights.detail.toGo") : t("insights.detail.reached")} right={money(Math.abs(toGo), goal.currency, toGo > 0 ? undefined : C.green)} style={styles.divider} /> : null}
              {pace !== null ? <Row title={t("insights.detail.avgChange", { count: done.length })} right={money(pace, h.currency, pace < 0 ? C.red : C.green)} style={goal ? styles.divider : undefined} /> : null}
              {goal && toGo > 0 ? <Row title={t("insights.detail.eta")} right={<Text style={styles.amount}>{eta ? t("insights.detail.etaAt", { month: eta.label, count: eta.months }) : t("insights.detail.etaNever")}</Text>} style={styles.divider} /> : null}
            </Card>
          </Section>
        ) : null}
        {balance ? <Section title={t("insights.detail.balance", { account: data.name ?? "" })}><HistoryChart series={balance} color={hue} kind="balance" /></Section> : null}
        <Section title={t("insights.detail.monthByMonth")}>
          <Card>
            {[...h.periods].reverse().map((x, i) => (
              <View key={x.start} style={[styles.monthRow, i > 0 && styles.divider]} accessible
                accessibilityLabel={t("insights.detail.monthA11y", { period: humanDayTime(x.start, null, undefined, true), income: amt(x.in_minor, h.currency), spent: amt(x.out_minor, h.currency), balance: amt(x.balance_minor, h.currency) })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName}>{periodLabelOf(x.start, x.end)}{x.current ? ` · ${t("insights.history.soFar")}` : ""}</Text>
                  <Text style={styles.rowSub}><Text style={{ color: C.green }}>+{formatMinor(x.in_minor, h.currency)}</Text>{"  "}<Text style={{ color: C.red }}>−{formatMinor(x.out_minor, h.currency)}</Text></Text>
                </View>
                {money(x.balance_minor, h.currency, x.balance_minor < 0 ? C.red : undefined)}
              </View>
            ))}
          </Card>
        </Section>
      </>;
    }
    case "checklist":
      // The sums the card leaves out: it says only what is still to pay, roughly.
      return <>
        {data.totals.length ? (
          <Section title={t("insights.detail.checklistSums", { period: pn })}>
            <Card>
              {data.totals.map((x, i) => (
                <View key={x.currency} style={i > 0 ? styles.divider : undefined}>
                  <Row title={t("insights.detail.stillToPay")} right={money(x.expected_minor, x.currency)} />
                  <Row title={t("insights.detail.paid")} right={money(x.paid_minor, x.currency, x.paid_minor ? C.green : undefined)} style={styles.divider} />
                  <Row title={t("insights.detail.inAll")} right={money(x.paid_minor + x.expected_minor, x.currency)} style={styles.divider} />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}
        <Histories series={data.history} title={spendTitle} hue={hue} />
      </>;
    case "subscriptions": {
      const { lines, totals } = data.v;
      if (!lines.length) return <Text style={styles.hint}>{t("insights.detail.noSubscriptions")}</Text>;
      const line = (l: (typeof lines)[number], i: number) => {
        const cat = l.rule.category_id ? data.cats.get(l.rule.category_id) : undefined;
        return (
          <Row key={l.rule.id} title={ruleTitle(l.rule)} subtitle={t("insights.subscriptions.amountPer", { amount: amt(Math.abs(l.rule.amount_minor), l.currency), per: perPeriod(l.rule.frequency, l.rule.interval) })}
            left={<PaymentIcon icon={shownPaymentIcon(l.rule)} category={cat ? { name: catName(cat), icon: cat.icon, color: cat.color } : null} size={30} />}
            right={money(l.yearly_minor, l.currency, l.included ? undefined : C.secondary)} style={i > 0 ? styles.divider : undefined}
            onPress={() => router.push({ pathname: "/recurring/[id]", params: { id: l.rule.id } })} />
        );
      };
      const counted = lines.filter((l) => l.included), left = lines.filter((l) => !l.included);
      return <>
        <Section title={t("insights.detail.totals")}>
          <Card>
            {totals.map((x, i) => (
              <View key={x.currency}>
                <Row title={t("insights.detail.perMonth", { currency: x.currency })} right={money(Math.round(x.minor / 12), x.currency)} style={i > 0 ? styles.divider : undefined} />
                <Row title={t("insights.detail.perYear", { currency: x.currency })} right={money(x.minor, x.currency)} style={styles.divider} />
              </View>
            ))}
          </Card>
        </Section>
        {counted.length ? <Section title={t("insights.detail.counted", { count: counted.length })}><Card>{counted.map(line)}</Card></Section> : null}
        {left.length ? <Section title={t("insights.detail.notCounted", { count: left.length })}><Card>{left.map(line)}</Card></Section> : null}
      </>;
    }
    case "regular":
      return <Histories series={data.series} weekly={data.weekly} hue={hue} empty={t("insights.detail.noHistory")}
        title={(currency) => data.weekly ? t("insights.detail.perWeekHistory", { currency }) : t("insights.detail.perMonthHistory", { currency })} />;
    case "values":
      return <Histories series={data.history} title={spendTitle} hue={hue} />;
    case "safety_buffer": {
      const b = data.b;
      if (!b) return null;
      return <>
        <Section title={t("insights.detail.counts")}>
          <Card>
            {data.accounts.map((a, i) => <Row key={a.id} title={acctName(a)} subtitle={a.currency !== b.currency ? a.currency : undefined} right={<AccountMoney id={a.id} currency={a.currency} />} style={i > 0 ? styles.divider : undefined} />)}
            <Row title={t("insights.detail.together", { currency: b.currency })} right={money(b.have_minor, b.currency)} style={styles.divider} />
          </Card>
        </Section>
        <Histories series={data.history} title={() => t("insights.detail.essentialHistory", { currency: b.currency })} hue={hue} />
      </>;
    }
    default:
      return null;
  }
}

/** What an account holds now, pending included — the figure the buffer counts. */
function AccountMoney({ id, currency }: { id: string; currency: string }) {
  const minor = useQuery((d) => accountBalanceMinor(d, id, { includePending: true }), [id]);
  return <Money minor={minor} currency={currency} style={styles.amount} />;
}

/** "Mar 2026" for a calendar month, "15 Mar – 14 Apr" for a period that starts on payday. */
function periodLabelOf(start: string, end: string): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  if (d === 1) return `${monthLong(m)} ${y}`;
  return `${humanDayTime(start)} – ${humanDayTime(prevDay(end))}`;
}
function prevDay(d: string): string { const [y, m, dd] = d.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd - 1)).toISOString().slice(0, 10); }

const styles = themed(() => StyleSheet.create({
  pills: { flexDirection: "row", paddingHorizontal: S.lg },
  amount: { fontSize: 16, fontWeight: "600", color: C.label, fontVariant: ["tabular-nums"] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.secondary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
  headerText: { paddingHorizontal: 12, paddingVertical: 6 },
  headerLink: { color: C.tint, fontSize: 17 },
  budgetRow: { paddingHorizontal: S.lg, paddingVertical: S.md, gap: 6 },
  budgetTop: { flexDirection: "row", alignItems: "center", gap: S.sm },
  rowName: { flex: 1, fontSize: 16, color: C.label },
  rowSub: { fontSize: 13, color: C.secondary },
  arrows: { flexDirection: "row", alignItems: "center", gap: S.md },
  arrow: { paddingHorizontal: 4 },
  arrowCount: { fontSize: 13, color: C.secondary, fontVariant: ["tabular-nums"] },
  monthRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingVertical: 10 },
}));
