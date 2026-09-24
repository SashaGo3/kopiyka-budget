import { useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { INSIGHT_KINDS, accountLeftover, categoryChecklist, daysToSalary, formatMinor, freeMoney, getRow, listRows, parseInsightParams, recurringSpendInsight, regularSpending, safeToSpend, safetyBuffer, savingsGoal, subscriptionsPerYear, upcomingPayments, valueSplit, type Insight, type InsightParams, type ValuePeriod } from "@kopiyka/core";
import { useQuery } from "@/store";
import { BarButton, BottomBar, useScrollHide } from "@/components/BottomBar";
import { CategoryIcon, Empty, FadeIn, Money, ProgressBar, TagPill } from "@/components/ui";
import { C, S, VALUE_LABEL, ValueRamp } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay } from "@/lib/period";
import { getBudgetScope } from "@/lib/settings";
import { INSIGHT_LOOK } from "@/lib/insights";
import { scopeAccount, scopeAccountIds } from "@/lib/scope";

/** User-added statistics cards. Each card is computed in core from its stored params. */
export default function InsightsScreen() {
  const insights = useQuery((db) => listRows(db, "insights", "deleted=0", [], "sort, rowid") as Insight[]);
  const { visible, onScroll } = useScrollHide();
  const canReorder = insights.length > 1;
  const reorder = () => router.push("/insight/reorder");
  return (
    <>
      <Stack.Screen options={{ title: "Insights", headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180, paddingTop: S.sm, gap: S.md }} onScroll={onScroll} scrollEventThrottle={16}>
        {insights.length === 0 ? <Empty title="No insights yet" hint="Cards that answer one question each — what is safe to spend, how long until salary, how a savings goal is going, what your subscriptions cost a year. Add the ones you want and drag them into your order." /> : null}
        {insights.map((i, n) => <FadeIn key={i.id} delay={n * 60}><InsightCard insight={i} reorder={canReorder ? reorder : undefined} /></FadeIn>)}
      </ScrollView>
      <BottomBar visible={visible}>
        <BarButton icon="plus" label="Add insight" onPress={() => router.push({ pathname: "/insight/edit", params: { id: "new" } })} a11y="Add insight" />
        {canReorder ? <BarButton icon="arrow.up.arrow.down" label="Reorder" onPress={reorder} a11y="Reorder insights" /> : null}
      </BottomBar>
    </>
  );
}

function InsightCard({ insight, reorder }: { insight: Insight; reorder?: () => void }) {
  const p = parseInsightParams(insight.params);
  const meta = INSIGHT_KINDS.find((k) => k.kind === insight.kind);
  const title = p.title || meta?.title || insight.kind;
  const look = INSIGHT_LOOK[insight.kind];
  return (
    <View style={styles.card}>
      <Pressable onPress={() => router.push({ pathname: "/insight/edit", params: { id: insight.id } })} onLongPress={reorder} style={styles.head}
        accessibilityRole="button" accessibilityLabel={`Edit ${title}`} accessibilityHint={reorder ? "Long press to reorder the insights" : undefined}>
        {look ? <SymbolView name={look.icon} size={15} tintColor={look.color} weight="semibold" /> : null}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
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
      case "values": return { kind: "values" as const, v: valueSplit(db, { today: todayLocal(), startDay, accountIds: scopeIds }) };
      case "safety_buffer": return { kind: "safety_buffer" as const, v: safetyBuffer(db, p, { today: todayLocal(), startDay }), name: p.account_id ? getRow(db, "accounts", p.account_id)?.name : undefined };
      case "safe_to_spend": return { kind: "safe_to_spend" as const, v: safeToSpend(db, { today: todayLocal(), startDay, accountIds: scopeIds, budgetAccount }) };
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
          if (last) router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id, amount: formatMinor(Math.abs(last.amount_minor), last.currency, { grouping: "" }), kind: last.amount_minor >= 0 ? "income" : "expense", note: last.notes ?? "", tags: last.tag_ids.join(","), account: last.account_id } });
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
            <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.line} numberOfLines={1}>{l.title}</Text><Text style={styles.sub}>{formatMinor(Math.abs(l.rule.amount_minor), l.currency)} {l.currency} {l.per_period}</Text></View>
            <Money minor={l.yearly_minor} currency={l.currency} style={styles.lineStrong} />
          </View>
        )) : null}</View>;
    }
    case "upcoming":
      return <View style={{ gap: 4 }}>{data.v.length ? data.v.map((u, i) => {
        const t = u.template;
        return <Pressable key={i} onPress={() => !u.done && router.push({ pathname: "/transaction/[id]", params: { id: "new", account: t.account_id, category: t.category_id ?? "", amount: formatMinor(Math.abs(t.amount_minor), u.currency, { grouping: "" }), kind: t.amount_minor >= 0 ? "income" : "expense", note: t.notes ?? "", tags: t.tag_ids.join(",") } })} style={styles.check} accessibilityRole="button" accessibilityLabel={`${t.notes ?? u.category_name ?? "Payment"}${u.done ? ", logged" : ", tap to log"}`}>
          <SymbolView name={u.done ? "checkmark.circle.fill" : "circle"} size={22} tintColor={u.done ? C.green : C.tertiary} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.line, u.done && { color: C.secondary }]} numberOfLines={1}>{t.notes || u.category_name || "Payment"}</Text><View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center" }}>{u.category_name && t.notes ? <Text style={styles.sub}>{u.category_name}</Text> : null}{u.tag_names.map((n) => <TagPill key={n} name={n} />)}</View></View>
          <Money minor={t.amount_minor} currency={u.currency} style={styles.line} />
        </Pressable>;
      }) : sub("Add payments from your history in the editor.")}{sub(`${data.v.filter((u) => !u.done).length} to go · ${period.subtitle ?? period.title}`)}</View>;
    case "regular":
      return <View>{data.v.length ? data.v.map((r) => <View key={r.currency}><Money minor={r.average_minor} currency={r.currency} style={styles.big} />{sub(`per ${r.frequency === "weekly" ? "week" : "month"} on ${data.names} · last ${r.frequency === "weekly" ? "week" : "month"} ${formatMinor(r.last_minor, r.currency)} ${r.currency}`)}</View>) : sub("Choose categories.")}</View>;
    case "values": {
      const v = data.v[0];
      if (!v) return sub("Nothing spent this period yet.");
      const now = v.now;
      const pct = (m: number) => (now.total_minor > 0 ? Math.round((m / now.total_minor) * 100) : 0);
      const first = v.periods.find((x) => x.essential_share !== null);
      return (
        <View style={{ gap: S.sm }}>
          <View>
            <Text style={styles.big}>{now.essential_share === null ? "—" : `${Math.round(now.essential_share * 100)}%`}</Text>
            {sub(`of ${period.subtitle ?? period.title} went on what you could not live without`)}
          </View>
          {/* Stacked bar: 2px surface gaps between segments, no borders, no labels inside — a
              segment can be one pixel wide and a label in it would be clipped. The legend below
              carries every number, which is also what keeps identity off colour alone. */}
          <View style={styles.stack}>
            {([3, 2, 1, 0] as const).map((lv) => (now.by_level[lv] > 0 ? (
              <View key={lv} style={{ flex: now.by_level[lv], backgroundColor: ValueRamp[lv], borderRadius: 3 }} />
            ) : null))}
          </View>
          {([3, 2, 1, 0] as const).map((lv) => (now.by_level[lv] > 0 ? (
            <View key={lv} style={styles.legend}>
              <View style={[styles.swatch, { backgroundColor: ValueRamp[lv] }]} />
              <Text style={styles.legendName} numberOfLines={1}>{VALUE_LABEL[lv]}</Text>
              <Money minor={now.by_level[lv]} currency={v.currency} style={styles.legendMoney} />
              <Text style={styles.legendPct}>{pct(now.by_level[lv])}%</Text>
            </View>
          ) : null))}
          {/* Six periods of the essential share. Only the ends are labelled: a number on every bar
              is chaos and goes unread, and the question here is the direction, not the values. */}
          <View style={styles.trendRow}>
            {v.periods.map((x: ValuePeriod) => (
              <View key={x.start} style={styles.trendSlot}>
                <View style={[styles.trendBar, { height: Math.max(2, Math.round((x.essential_share ?? 0) * 34)), backgroundColor: x === now ? ValueRamp[3] : ValueRamp[2] }]} />
              </View>
            ))}
          </View>
          {first && first !== now && first.essential_share !== null && now.essential_share !== null
            ? sub(`Essentials were ${Math.round(first.essential_share * 100)}% six periods ago${Math.abs(now.essential_share - first.essential_share) < 0.02 ? " — about the same" : now.essential_share > first.essential_share ? " — less room than there was" : " — more room than there was"}`)
            : sub("Six periods, oldest first.")}
          {v.unmarked_minor > 0 ? sub("Categories nobody has marked are counted separately, not guessed at.") : null}
        </View>
      );
    }
    case "safety_buffer": {
      if (!data.v) return sub("Choose an account.");
      const b = data.v;
      if (b.no_essentials) return (
        <View>
          <Text style={styles.line}>Nothing is marked as essential yet.</Text>
          {sub("Settings → Categories → Set what matters. Then this says how many months this account would cover.")}
        </View>
      );
      return (
        <View style={{ gap: 6 }}>
          <Text style={styles.big}>{b.months_covered === null ? "—" : `${b.months_covered.toFixed(1)} months`}</Text>
          {sub(`${data.name ?? "This account"} covered, at what your essentials actually cost`)}
          <ProgressBar ratio={b.ratio} color={b.ratio >= 1 ? ValueRamp[3] : ValueRamp[2]} />
          <Text style={styles.line}>
            <Money minor={b.have_minor} currency={b.currency} style={styles.lineStrong} /> of <Money minor={b.target_minor} currency={b.currency} style={styles.lineStrong} />
          </Text>
          {sub(`${b.months_wanted} month${b.months_wanted === 1 ? "" : "s"} of essentials, averaging ${formatMinor(b.essential_minor, b.currency)} ${b.currency} a month over ${b.periods} periods. The target moves on its own as life gets more expensive.`)}
        </View>
      );
    }
    case "safe_to_spend": {
      const v = data.v;
      if (!v.safe.length) return sub("No budgets for this period yet, and nothing due before the next salary.");
      return (
        <View style={{ gap: 6 }}>
          {v.safe.map((m) => <Money key={m.currency} minor={m.minor} currency={m.currency} style={[styles.big, { color: m.minor < 0 ? C.red : C.label }]} />)}
          {sub(`safe to spend over ${v.days} day${v.days === 1 ? "" : "s"} until ${humanDayTime(v.next)}`)}
          {v.per_day.map((m) => <Text key={m.currency} style={styles.line}><Money minor={m.minor} currency={m.currency} style={styles.lineStrong} /> per day</Text>)}
          {v.committed.length ? (
            <Text style={styles.sub}>
              {v.free.map((f) => `${formatMinor(f.minor, f.currency)} free`).join(" · ")}
              {" less "}
              {v.committed.map((c) => `${formatMinor(c.minor, c.currency)} still to be charged`).join(" · ")}
            </Text>
          ) : sub("Nothing else is due before then.")}
        </View>
      );
    }
  }
}

function formatDiff(minor: number, currency: string) { return minor > 0 ? `${formatMinor(minor, currency)} ${currency} to go` : "Goal reached 🎉"; }

const styles = StyleSheet.create({
  card: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 16, padding: S.lg, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.3 },
  big: { fontSize: 30, fontWeight: "700", color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  line: { fontSize: 15, color: C.label },
  lineStrong: { fontSize: 15, fontWeight: "600", color: C.label },
  link: { color: C.tint, fontSize: 14, fontWeight: "600", paddingTop: 4 },
  check: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 36 },
  subRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  stack: { flexDirection: "row", gap: 2, height: 12, marginTop: 2 },
  legend: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 22 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendName: { flex: 1, fontSize: 14, color: C.label },
  legendMoney: { fontSize: 14, color: C.label, fontVariant: ["tabular-nums"] },
  legendPct: { fontSize: 13, color: C.secondary, width: 38, textAlign: "right", fontVariant: ["tabular-nums"] },
  trendRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 34, marginTop: S.sm },
  trendSlot: { flex: 1, justifyContent: "flex-end" },
  trendBar: { borderRadius: 2 },
});
