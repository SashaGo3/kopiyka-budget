import { useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { INSIGHT_KINDS, accountLeftover, categoryChecklist, daysToSalary, formatMinor, freeMoney, getRow, listRows, parseInsightParams, recurringSpendInsight, regularSpending, savingsGoal, subscriptionsPerYear, upcomingPayments, type Insight, type InsightParams } from "@kopiyka/core";
import { useQuery } from "@/store";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { CategoryIcon, Empty, FadeIn, Money, ProgressBar, TagPill } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay } from "@/lib/period";
import { getBudgetScope } from "@/lib/settings";
import { scopeAccount, scopeAccountIds } from "@/lib/scope";

/** User-added statistics cards. Each card is computed in core from its stored params. */
export default function InsightsScreen() {
  const insights = useQuery((db) => listRows(db, "insights", "deleted=0", [], "sort, rowid") as Insight[]);
  const { visible, onScroll } = useScrollHide();
  return (
    <>
      <Stack.Screen options={{ title: "Insights", headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180, paddingTop: S.sm, gap: S.md }} onScroll={onScroll} scrollEventThrottle={16}>
        {insights.length === 0 ? <Empty title="No insights yet" hint="Add free money left, days until salary, what is left on an account, a savings goal, a payments checklist, subscriptions per year, what your recurring rules took this period, upcoming payments or regular spending." /> : null}
        {insights.map((i, n) => <FadeIn key={i.id} delay={n * 60}><InsightCard insight={i} /></FadeIn>)}
      </ScrollView>
      <BottomBar visible={visible}>
        <BarButton icon="plus" label="Add insight" onPress={() => router.push({ pathname: "/insight/edit", params: { id: "new" } })} a11y="Add insight" />
      </BottomBar>
    </>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const p = parseInsightParams(insight.params);
  const meta = INSIGHT_KINDS.find((k) => k.kind === insight.kind);
  const title = p.title || meta?.title || insight.kind;
  return (
    <View style={styles.card}>
      <Pressable onPress={() => router.push({ pathname: "/insight/edit", params: { id: insight.id } })} style={styles.head} accessibilityRole="button" accessibilityLabel={`Edit ${title}`}>
        <Text style={styles.title}>{title}</Text>
        <SymbolView name="ellipsis.circle" size={18} tintColor={C.tertiary} />
      </Pressable>
      <Body insight={insight} p={p} />
    </View>
  );
}

function Body({ insight, p }: { insight: Insight; p: InsightParams }) {
  const startDay = useQuery(() => getPeriodStartDay());
  const scope = useQuery(() => getBudgetScope());
  const accounts = useQuery((db) => listRows(db, "accounts", "1=1"));
  const scopeIds = scopeAccountIds(scope, accounts);
  const budgetAccount = scopeAccount(scope);
  const period = currentPeriod(startDay);
  const [open, setOpen] = useState(false);
  const data = useQuery((db) => {
    switch (insight.kind) {
      case "free_money": return { kind: "free_money" as const, v: freeMoney(db, { start: period.start, end: period.end, accountIds: scopeIds, budgetAccount }) };
      case "days_to_salary": return { kind: "days_to_salary" as const, v: daysToSalary(db, { today: todayLocal(), startDay, accountIds: scopeIds, budgetAccount }) };
      case "savings_goal": return { kind: "savings_goal" as const, v: savingsGoal(db, p), name: p.account_id ? getRow(db, "accounts", p.account_id)?.name : undefined };
      case "account_balance": return { kind: "account_balance" as const, v: accountLeftover(db, p, { start: period.start, end: period.end }) };
      case "checklist": return { kind: "checklist" as const, v: categoryChecklist(db, p, { start: period.start, end: period.end, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      case "subscriptions": return { kind: "subscriptions" as const, v: subscriptionsPerYear(db, p) };
      case "recurring_spend": return { kind: "recurring_spend" as const, v: recurringSpendInsight(db, { start: period.start, end: period.end, accountIds: scopeIds, today: todayLocal() }) };
      case "upcoming": return { kind: "upcoming" as const, v: upcomingPayments(db, p, { start: period.start, end: period.end }) };
      case "regular": return { kind: "regular" as const, v: regularSpending(db, p, { today: todayLocal(), accountIds: scopeIds }), names: (p.category_ids ?? []).map((id) => getRow(db, "categories", id)?.name).filter(Boolean).join(", ") };
      default: return { kind: "gone" as const };
    }
  }, [insight.id, insight.params, period.start, scope, startDay]);
  const sub = (t: string) => <Text style={styles.sub}>{t}</Text>;

  switch (data.kind) {
    case "gone":
      return sub("This kind of insight is no longer available — remove it with the ⋯ button.");
    case "free_money":
      return <View>{data.v.length ? data.v.map((m) => <Money key={m.currency} minor={m.minor} currency={m.currency} style={[styles.big, { color: m.minor < 0 ? C.red : C.green }]} />) : sub("No budgets for this period yet.")}{sub(`Left of your budgets · ${period.subtitle ?? period.title}`)}</View>;
    case "days_to_salary":
      return <View><Text style={styles.big}>{data.v.days} day{data.v.days === 1 ? "" : "s"}</Text>{sub(`until ${humanDayTime(data.v.next)}`)}{data.v.per_day.map((m) => <Text key={m.currency} style={styles.line}><Money minor={m.minor} currency={m.currency} style={styles.lineStrong} /> per day</Text>)}</View>;
    case "savings_goal": {
      if (!data.v) return sub("Choose an account.");
      const { balance, target, currency, ratio } = data.v;
      return <View>{sub(data.name ?? "")}<Text style={styles.line}><Money minor={balance} currency={currency} style={styles.lineStrong} /> of <Money minor={target} currency={currency} style={styles.lineStrong} /></Text>
        <View style={{ marginVertical: 6 }}><ProgressBar ratio={ratio} color={ratio >= 1 ? C.green : C.tint} height={8} /></View>{sub(`${Math.round(ratio * 100)}% · ${formatDiff(target - balance, currency)}`)}</View>;
    }
    case "account_balance": {
      if (!data.v) return sub("Choose an account.");
      const a = data.v;
      const waiting = a.with_pending_minor - a.balance_minor;
      return <View>
        <Money minor={a.balance_minor} currency={a.currency} style={[styles.big, { color: a.balance_minor < 0 ? C.red : C.label }]} />
        {sub(`left on ${a.name}${waiting ? ` · ${formatMinor(a.with_pending_minor, a.currency)} with pending` : ""}`)}
        <Text style={styles.line}>
          <Money minor={a.in_minor} currency={a.currency} style={[styles.lineStrong, { color: C.green }]} /> in ·{" "}
          <Money minor={a.out_minor} currency={a.currency} style={styles.lineStrong} /> out
        </Text>
        {sub(period.subtitle ?? period.title)}
      </View>;
    }
    case "checklist":
      return <View style={{ gap: 4 }}>{data.v.length ? data.v.map((c) => {
        const cat = data.cats.get(c.category_id);
        const openLog = () => {
          if (c.done) return;
          const last = c.last;
          if (last) router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id, amount: String(Math.abs(last.amount_minor) / 100), kind: last.amount_minor >= 0 ? "income" : "expense", note: last.notes ?? "", tags: last.tag_ids.join(","), account: last.account_id } });
          else router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id } });
        };
        return <Pressable key={c.category_id} onPress={openLog} style={styles.check} accessibilityRole="button" accessibilityLabel={`${c.name}${c.done ? ", done" : ", not yet"}`}>
          <SymbolView name={c.done ? "checkmark.circle.fill" : "circle"} size={22} tintColor={c.done ? C.green : C.tertiary} /><CategoryIcon name={c.name} icon={cat?.icon} color={cat?.color} size={22} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.line, c.done && { color: C.secondary }]}>{c.name}</Text>
            {!c.done && c.last ? <Text style={styles.sub}>Last {formatMinor(Math.abs(c.last.amount_minor), c.last.currency)} {c.last.currency} · {humanDayTime(c.last.date.slice(0, 10))}</Text> : null}
          </View>
          {c.done && c.currency ? <Money minor={-c.spent_minor} currency={c.currency} style={styles.sub} /> : null}
        </Pressable>;
      }) : sub("Choose categories to watch.")}{sub(`${data.v.filter((c) => !c.done).length} still missing · ${period.subtitle ?? period.title}`)}</View>;
    case "recurring_spend": {
      const { lines, totals, due } = data.v;
      if (!lines.length) return (
        <View>
          {sub(`No recurring rule has posted anything in ${period.subtitle ?? period.title}.${due ? ` ${due} waiting to be confirmed.` : ""}`)}
          <Pressable onPress={() => router.push("/settings/recurring")} accessibilityRole="button" accessibilityLabel="All recurring rules"><Text style={styles.link}>All rules</Text></Pressable>
        </View>
      );
      return <View>{totals.map((t) => <Money key={t.currency} minor={t.minor} currency={t.currency} style={styles.big} />)}
        {sub(`from ${lines.length} rule${lines.length === 1 ? "" : "s"} · ${period.subtitle ?? period.title}${due ? ` · ${due} still due` : ""}`)}
        <View style={{ flexDirection: "row", gap: S.lg }}>
          <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); }} accessibilityRole="button" accessibilityLabel={open ? "Hide list" : "Show list"} accessibilityState={{ expanded: open }}><Text style={styles.link}>{open ? "Hide" : "Show"} list</Text></Pressable>
          <Pressable onPress={() => router.push("/settings/recurring")} accessibilityRole="button" accessibilityLabel="All recurring rules"><Text style={styles.link}>All rules</Text></Pressable>
        </View>
        {/* Wrapped so the gap under the links exists only while the list is open. */}
        {open ? (
          <View style={{ marginTop: S.sm }}>
            {lines.map((l) => (
              <Pressable key={l.rule.id} onPress={() => router.push({ pathname: "/recurring/[id]", params: { id: l.rule.id } })} style={styles.subRow} accessibilityRole="button" accessibilityLabel={`${l.title}, edit rule`}>
                <Text style={[styles.line, { flex: 1 }]} numberOfLines={1}>{l.title}{l.n > 1 ? ` ×${l.n}` : ""}</Text>
                <Money minor={l.spent_minor} currency={l.currency} style={styles.lineStrong} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>;
    }
    case "subscriptions": {
      const included = data.v.lines.filter((l) => l.included);
      return <View>{data.v.totals.map((t) => <Money key={t.currency} minor={t.minor} currency={t.currency} style={styles.big} />)}{sub(`per year · ${included.length} of ${data.v.lines.length} rules`)}
        <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); }} accessibilityRole="button" accessibilityLabel={open ? "Hide list" : "Show list"} accessibilityState={{ expanded: open }}><Text style={styles.link}>{open ? "Hide" : "Show"} list</Text></Pressable>
        {open ? included.map((l) => (
          <View key={l.rule.id} style={styles.subRow}>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.line} numberOfLines={1}>{l.title}</Text><Text style={styles.sub}>{(Math.abs(l.rule.amount_minor) / 100).toLocaleString()} {l.currency} {l.per_period}</Text></View>
            <Money minor={l.yearly_minor} currency={l.currency} style={styles.lineStrong} />
          </View>
        )) : null}</View>;
    }
    case "upcoming":
      return <View style={{ gap: 4 }}>{data.v.length ? data.v.map((u, i) => {
        const t = u.template;
        return <Pressable key={i} onPress={() => !u.done && router.push({ pathname: "/transaction/[id]", params: { id: "new", account: t.account_id, category: t.category_id ?? "", amount: String(Math.abs(t.amount_minor) / 100), kind: t.amount_minor >= 0 ? "income" : "expense", note: t.notes ?? "", tags: t.tag_ids.join(",") } })} style={styles.check} accessibilityRole="button" accessibilityLabel={`${t.notes ?? u.category_name ?? "Payment"}${u.done ? ", logged" : ", tap to log"}`}>
          <SymbolView name={u.done ? "checkmark.circle.fill" : "circle"} size={22} tintColor={u.done ? C.green : C.tertiary} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.line, u.done && { color: C.secondary }]} numberOfLines={1}>{t.notes || u.category_name || "Payment"}</Text><View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center" }}>{u.category_name && t.notes ? <Text style={styles.sub}>{u.category_name}</Text> : null}{u.tag_names.map((n) => <TagPill key={n} name={n} />)}</View></View>
          <Money minor={t.amount_minor} currency={u.currency} style={styles.line} />
        </Pressable>;
      }) : sub("Add payments from your history in the editor.")}{sub(`${data.v.filter((u) => !u.done).length} to go · ${period.subtitle ?? period.title}`)}</View>;
    case "regular":
      return <View>{data.v.length ? data.v.map((r) => <View key={r.currency}><Money minor={r.average_minor} currency={r.currency} style={styles.big} />{sub(`per ${r.frequency === "weekly" ? "week" : "month"} on ${data.names} · last ${r.frequency === "weekly" ? "week" : "month"} ${(r.last_minor / 100).toLocaleString()} ${r.currency}`)}</View>) : sub("Choose categories.")}</View>;
  }
}

function formatDiff(minor: number, currency: string) { return minor > 0 ? `${(minor / 100).toLocaleString()} ${currency} to go` : "Goal reached 🎉"; }

const styles = StyleSheet.create({
  card: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 16, padding: S.lg, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "600", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.3 },
  big: { fontSize: 30, fontWeight: "700", color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  line: { fontSize: 15, color: C.label },
  lineStrong: { fontSize: 15, fontWeight: "600", color: C.label },
  link: { color: C.tint, fontSize: 14, fontWeight: "600", paddingTop: 4 },
  check: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 36 },
  subRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
});
