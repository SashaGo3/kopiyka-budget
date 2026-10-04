import { useState, type ReactNode } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountLeftover, categoryChecklist, save, checklistTotals, daysToSalary, formatMinor, freeMoney, getRow, listRows, parseInsightParams, recurringSpendInsight, regularSpending, safeToSpend, safetyBuffer, savingsGoal, subscriptionsPerYear, upcomingPayments, valueSplit, type Insight, type InsightParams, type ValuePeriod } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { CategoryIcon, Money, ProgressBar, TagPill } from "@/components/ui";
import { C, S, ValueRamp, themed, themeHue } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay } from "@/lib/period";
import { getBudgetScope } from "@/lib/settings";
import { INSIGHT_LOOK, kindTitle, perPeriod, ruleTitle } from "@/lib/insights";
import { catName, catNameById, acctName } from "@/lib/names";
import { t, Trans } from "@/i18n";
import { scopeAccount, scopeAccountIds } from "@/lib/scope";

/**
 * One insight card: its heading and what it computes to now. The Insights screen lists them; the
 * editor draws one from the settings being chosen (`preview`), so what Save will add is on screen
 * while it is being set up rather than discovered afterwards.
 */
export function InsightCard({ insight, reorder, preview }: { insight: Insight; reorder?: () => void; preview?: boolean }) {
  const p = parseInsightParams(insight.params);
  const title = p.title || kindTitle(insight.kind);
  const look = INSIGHT_LOOK[insight.kind];
  return (
    <View style={styles.card}>
      <Pressable onPress={() => router.push({ pathname: "/insight/edit", params: { id: insight.id } })} onLongPress={reorder} style={styles.head} disabled={preview}
        accessibilityRole="button" accessibilityLabel={t("insights.editLabel", { title })} accessibilityHint={reorder ? t("insights.reorderHint") : undefined}>
        {look ? <SymbolView name={look.icon} size={15} tintColor={themeHue(look.color)} weight="semibold" /> : null}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {preview ? null : <SymbolView name="ellipsis.circle" size={18} tintColor={C.tertiary} />}
      </Pressable>
      <Body insight={insight} p={p} preview={preview} />
    </View>
  );
}

function Body({ insight, p, preview }: { insight: Insight; p: InsightParams; preview?: boolean }) {
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
      case "savings_goal": return { kind: "savings_goal" as const, v: savingsGoal(db, p), name: p.account_id ? acctName(getRow(db, "accounts", p.account_id)) : undefined };
      case "account_balance": return { kind: "account_balance" as const, v: accountLeftover(db, p, { start: period.start, end: period.end }) };
      case "checklist": return { kind: "checklist" as const, v: categoryChecklist(db, p, { start: period.start, end: period.end, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])), tags: new Map(listRows(db, "tags", "1=1").map((x) => [x.id, x])), rules: new Map(listRows(db, "recurring_rules", "1=1").map((r) => [r.id, r])) };
      case "subscriptions": return { kind: "subscriptions" as const, v: subscriptionsPerYear(db, p) };
      case "recurring_spend": return { kind: "recurring_spend" as const, v: recurringSpendInsight(db, { start: period.start, end: period.end, accountIds: scopeIds, today: todayLocal() }) };
      case "upcoming": return { kind: "upcoming" as const, v: upcomingPayments(db, p, { start: period.start, end: period.end }) };
      case "regular": return { kind: "regular" as const, v: regularSpending(db, p, { today: todayLocal(), accountIds: scopeIds }), names: (p.category_ids ?? []).map((id) => { const c = getRow(db, "categories", id); return c ? catName(c) : null; }).filter(Boolean).join(", ") };
      case "values": return { kind: "values" as const, v: valueSplit(db, { today: todayLocal(), startDay, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      case "safety_buffer": return { kind: "safety_buffer" as const, v: safetyBuffer(db, p, { today: todayLocal(), startDay }), name: p.account_id ? acctName(getRow(db, "accounts", p.account_id)) : undefined };
      case "safe_to_spend": return { kind: "safe_to_spend" as const, v: safeToSpend(db, { today: todayLocal(), startDay, accountIds: scopeIds, budgetAccount }) };
      default: return { kind: "gone" as const };
    }
  }, [insight.id, insight.params, period.start, scope, startDay]);
  const sub = (s: string) => <Text style={styles.sub}>{s}</Text>;
  const pn = period.subtitle ?? period.title;
  const strong = { b: (c: ReactNode) => <Text style={styles.lineStrong}>{c}</Text>, g: (c: ReactNode) => <Text style={[styles.lineStrong, { color: C.green }]}>{c}</Text> };
  const amt = (minor: number, currency: string) => `${formatMinor(minor, currency)} ${currency}`;

  switch (data.kind) {
    case "gone":
      return sub(t("insights.gone"));
    case "free_money":
      return <View>{data.v.length ? data.v.map((m) => <Money key={m.currency} minor={m.minor} currency={m.currency} style={[styles.big, { color: m.minor < 0 ? C.red : C.green }]} />) : sub(t("insights.noBudgets"))}{sub(t("insights.free.left", { period: pn }))}</View>;
    case "days_to_salary":
      return <View><Text style={styles.big}>{t("insights.days", { count: data.v.days })}</Text>{sub(t("insights.salary.until", { day: humanDayTime(data.v.next) }))}{data.v.per_day.map((m) => <Text key={m.currency} style={styles.line}><Trans k="insights.perDay" vars={{ amount: amt(m.minor, m.currency) }} tags={strong} /></Text>)}</View>;
    case "savings_goal": {
      if (!data.v) return sub(t("insights.chooseAccount"));
      const { balance, target, currency, ratio } = data.v;
      return <View>{sub(data.name ?? "")}<Text style={styles.line}><Trans k="insights.of" vars={{ have: amt(balance, currency), target: amt(target, currency) }} tags={strong} /></Text>
        <View style={{ marginVertical: 6 }}><ProgressBar ratio={ratio} color={ratio >= 1 ? C.green : C.tint} height={8} /></View>{sub(`${Math.round(ratio * 100)}% · ${formatDiff(target - balance, currency)}`)}</View>;
    }
    case "account_balance": {
      if (!data.v) return sub(t("insights.chooseAccount"));
      const a = data.v;
      const waiting = a.with_pending_minor - a.balance_minor;
      return <View>
        <Money minor={a.balance_minor} currency={a.currency} style={[styles.big, { color: a.balance_minor < 0 ? C.red : C.label }]} />
        {sub(waiting ? t("insights.balance.leftPending", { account: acctName(a), amount: formatMinor(a.with_pending_minor, a.currency) }) : t("insights.balance.left", { account: acctName(a) }))}
        <Text style={styles.line}>
          <Trans k="insights.balance.inOut" vars={{ income: amt(a.in_minor, a.currency), spent: amt(a.out_minor, a.currency) }} tags={strong} />
        </Text>
        {sub(period.subtitle ?? period.title)}
      </View>;
    }
    case "checklist": {
      // One small line per currency: roughly what is still to pay (the open lines' last payment, or
      // the rule's amount for each time it is still due) — or, set to `total`, that plus what was
      // paid — then what was paid. A part that comes to nothing is left out rather than shown as a
      // zero. Tapping the line switches between the two and keeps the choice.
      const total = p.sum === "total";
      const totals = checklistTotals(data.v).flatMap((x) => {
        const parts = [
          x.expected_minor ? (total ? t("insights.checklist.summaryTotal", { amount: amt(x.paid_minor + x.expected_minor, x.currency) }) : t("insights.checklist.summaryLeft", { amount: amt(x.expected_minor, x.currency) })) : null,
          x.paid_minor ? t("insights.checklist.summaryPaid", { amount: amt(x.paid_minor, x.currency) }) : null,
        ].filter(Boolean);
        return parts.length ? [{ currency: x.currency, text: parts.join(" · ") }] : [];
      });
      const flipSum = () => { if (!preview) mutate((d) => save(d, "insights", { ...insight, params: JSON.stringify({ ...p, sum: total ? undefined : "total" }) })); };
      const missing = data.v.filter((c) => !c.done).length;
      const lines = p.hide_done ? data.v.filter((c) => !c.done) : data.v;
      const hidden = data.v.length - lines.length;
      return <View style={{ gap: 4 }}>
        {totals.length ? (
          <Pressable onPress={flipSum} disabled={preview} accessibilityRole="button" accessibilityHint={t("insights.checklist.sumLabel")}>
            {totals.map((x) => <Text key={x.currency} style={styles.sub}>{x.text}</Text>)}
          </Pressable>
        ) : null}
        {data.v.length ? lines.map((c) => {
        const cat = data.cats.get(c.category_id);
        const rule = c.rule_id ? data.rules.get(c.rule_id) : undefined;
        const tag = c.tag_id ? data.tags.get(c.tag_id) : undefined;
        const name = rule ? ruleTitle(rule) : cat ? catName(cat) : c.name;
        const openLog = () => {
          if (c.done) return;
          // A recurring line goes to its rule: confirming the occurrence once it is due, the rule itself before.
          if (rule) { router.push(c.due && c.due <= todayLocal() ? { pathname: "/recurring/confirm", params: { id: rule.id } } : { pathname: "/recurring/[id]", params: { id: rule.id } }); return; }
          const last = c.last;
          const tags = last ? last.tag_ids.join(",") : c.tag_id ?? "";
          if (last) router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id, amount: formatMinor(Math.abs(last.amount_minor), last.currency, { grouping: "", decimal: "." }), kind: last.amount_minor >= 0 ? "income" : "expense", note: last.notes ?? "", tags, account: last.account_id } });
          else router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id, ...(tags ? { tags } : {}) } });
        };
        const label = tag ? `${name} #${tag.name}` : name;
        // A payment due several times this period (weekly lessons) shows how many of them are paid.
        const times = c.occurrences && c.occurrences.total > 1 ? c.occurrences : null;
        const hint = !c.done
          ? rule ? (c.due ? t("insights.checklist.due", { amount: amt(Math.abs(rule.amount_minor), c.currency ?? ""), day: humanDayTime(c.due) }) : null)
            : c.last ? t("insights.checklist.last", { amount: amt(Math.abs(c.last.amount_minor), c.last.currency), day: humanDayTime(c.last.date.slice(0, 10)) }) : null
          : null;
        return <Pressable key={c.key} onPress={openLog} style={styles.check} accessibilityRole="button" accessibilityLabel={c.done ? t("insights.checklist.doneLabel", { name: label }) : t("insights.checklist.notYetLabel", { name: label })}>
          <SymbolView name={c.done ? "checkmark.circle.fill" : "circle"} size={22} tintColor={c.done ? C.green : C.tertiary} />
          {rule ? <View style={styles.ruleIcon}><SymbolView name="repeat" size={12} tintColor={C.secondary} /></View> : <CategoryIcon name={name} icon={cat?.icon} color={cat?.color} size={22} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.checkTitle}>
              <Text style={[styles.line, { flexShrink: 1 }, c.done && { color: C.secondary }]} numberOfLines={2}>{name}</Text>
              {tag ? <TagPill name={tag.name} color={tag.color} /> : null}
            </View>
            {times ? (
              <View style={styles.times} accessible accessibilityLabel={t("insights.checklist.timesLabel", { paid: times.paid, total: times.total })}>
                {times.total <= 8 ? Array.from({ length: times.total }, (_, i) => <View key={i} style={[styles.dot, { backgroundColor: i < times.paid ? C.green : C.fill }]} />) : null}
                <Text style={styles.sub}>{t("insights.checklist.times", { paid: times.paid, total: times.total })}</Text>
              </View>
            ) : null}
            {hint ? <Text style={styles.sub}>{hint}</Text> : null}
          </View>
          {c.spent_minor && c.currency && (c.done || times) ? <Money minor={-c.spent_minor} currency={c.currency} style={styles.sub} /> : null}
        </Pressable>;
      }) : sub(t("insights.checklist.choose"))}{hidden ? sub(t("insights.checklist.hiddenDone", { count: hidden })) : null}{data.v.length ? sub(missing ? t("insights.checklist.missing", { count: missing, period: pn }) : t("insights.checklist.allDone", { period: pn })) : null}</View>;
    }
    case "recurring_spend": {
      const { lines, totals, due } = data.v;
      if (!lines.length) return (
        <View>
          {sub(due ? t("insights.recurringSpend.noneWaiting", { period: pn, count: due }) : t("insights.recurringSpend.none", { period: pn }))}
          <Pressable onPress={() => router.push("/settings/recurring")} accessibilityRole="button" accessibilityLabel={t("insights.recurringSpend.allRulesLabel")}><Text style={styles.link}>{t("insights.recurringSpend.allRules")}</Text></Pressable>
        </View>
      );
      return <View>{totals.map((x) => <Money key={x.currency} minor={x.minor} currency={x.currency} style={styles.big} />)}
        {sub(due ? t("insights.recurringSpend.fromDue", { count: lines.length, period: pn, due }) : t("insights.recurringSpend.from", { count: lines.length, period: pn }))}
        <View style={{ flexDirection: "row", gap: S.lg }}>
          <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); }} accessibilityRole="button" accessibilityState={{ expanded: open }}><Text style={styles.link}>{open ? t("insights.hideList") : t("insights.showList")}</Text></Pressable>
          <Pressable onPress={() => router.push("/settings/recurring")} accessibilityRole="button" accessibilityLabel={t("insights.recurringSpend.allRulesLabel")}><Text style={styles.link}>{t("insights.recurringSpend.allRules")}</Text></Pressable>
        </View>
        {/* Wrapped so the gap under the links exists only while the list is open. */}
        {open ? (
          <View style={{ marginTop: S.sm }}>
            {lines.map((l) => (
              <Pressable key={l.rule.id} onPress={() => router.push({ pathname: "/recurring/[id]", params: { id: l.rule.id } })} style={styles.subRow} accessibilityRole="button" accessibilityLabel={t("insights.recurringSpend.editRule", { title: ruleTitle(l.rule) })}>
                <Text style={[styles.line, { flex: 1 }]} numberOfLines={1}>{ruleTitle(l.rule)}{l.n > 1 ? ` ×${l.n}` : ""}</Text>
                <Money minor={l.spent_minor} currency={l.currency} style={styles.lineStrong} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>;
    }
    case "subscriptions": {
      const included = data.v.lines.filter((l) => l.included);
      return <View>{data.v.totals.map((x) => <Money key={x.currency} minor={x.minor} currency={x.currency} style={styles.big} />)}{sub(t("insights.subscriptions.perYear", { included: included.length, count: data.v.lines.length }))}
        <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); }} accessibilityRole="button" accessibilityState={{ expanded: open }}><Text style={styles.link}>{open ? t("insights.hideList") : t("insights.showList")}</Text></Pressable>
        {open ? included.map((l) => (
          <View key={l.rule.id} style={styles.subRow}>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.line} numberOfLines={1}>{ruleTitle(l.rule)}</Text><Text style={styles.sub}>{t("insights.subscriptions.amountPer", { amount: amt(Math.abs(l.rule.amount_minor), l.currency), per: perPeriod(l.rule.frequency, l.rule.interval) })}</Text></View>
            <Money minor={l.yearly_minor} currency={l.currency} style={styles.lineStrong} />
          </View>
        )) : null}</View>;
    }
    case "upcoming":
      return <View style={{ gap: 4 }}>{data.v.length ? data.v.map((u, i) => {
        const tp = u.template;
        const catLabel = catNameById(tp.category_id, u.category_name);
        const label = tp.notes || catLabel || t("insights.payment");
        return <Pressable key={i} onPress={() => !u.done && router.push({ pathname: "/transaction/[id]", params: { id: "new", account: tp.account_id, category: tp.category_id ?? "", amount: formatMinor(Math.abs(tp.amount_minor), u.currency, { grouping: "", decimal: "." }), kind: tp.amount_minor >= 0 ? "income" : "expense", note: tp.notes ?? "", tags: tp.tag_ids.join(",") } })} style={styles.check} accessibilityRole="button" accessibilityLabel={u.done ? t("insights.upcoming.loggedLabel", { name: label }) : t("insights.upcoming.logLabel", { name: label })}>
          <SymbolView name={u.done ? "checkmark.circle.fill" : "circle"} size={22} tintColor={u.done ? C.green : C.tertiary} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.line, u.done && { color: C.secondary }]} numberOfLines={1}>{label}</Text><View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center" }}>{catLabel && tp.notes ? <Text style={styles.sub}>{catLabel}</Text> : null}{u.tag_names.map((n) => <TagPill key={n} name={n} />)}</View></View>
          <Money minor={tp.amount_minor} currency={u.currency} style={styles.line} />
        </Pressable>;
      }) : sub(t("insights.upcoming.empty"))}{sub(t("insights.upcoming.toGo", { count: data.v.filter((u) => !u.done).length, period: pn }))}</View>;
    case "regular":
      return <View>{data.v.length ? data.v.map((r) => <View key={r.currency}><Money minor={r.average_minor} currency={r.currency} style={styles.big} />{sub(r.frequency === "weekly" ? t("insights.regular.weekly", { names: data.names, last: amt(r.last_minor, r.currency) }) : t("insights.regular.monthly", { names: data.names, last: amt(r.last_minor, r.currency) }))}</View>) : sub(t("insights.regular.choose"))}</View>;
    case "values": {
      const v = data.v[0];
      if (!v) return sub(t("insights.values.nothing"));
      const now = v.now;
      const pct = (m: number) => (now.total_minor > 0 ? Math.round((m / now.total_minor) * 100) : 0);
      const first = v.periods.find((x) => x.essential_share !== null);
      return (
        <View style={{ gap: S.sm }}>
          <View>
            <Text style={styles.big}>{now.essential_share === null ? "—" : `${Math.round(now.essential_share * 100)}%`}</Text>
            {sub(t("insights.values.share", { period: pn }))}
          </View>
          {/* Stacked bar: 2px surface gaps between segments, no borders, no labels inside — a
              segment can be one pixel wide and a label in it would be clipped. The legend below
              carries every number, which is also what keeps identity off colour alone. */}
          <View style={styles.stack}>
            {([3, 2, 1, 0] as const).map((lv) => (now.by_level[lv] > 0 ? (
              <View key={lv} style={{ flex: now.by_level[lv], backgroundColor: ValueRamp[lv], borderRadius: 3 }} />
            ) : null))}
          </View>
          {/* Each level names what it is made of, biggest first, so the split can be checked against
              the marks behind it instead of taken on trust. */}
          {([3, 2, 1, 0] as const).map((lv) => {
            if (now.by_level[lv] <= 0) return null;
            // Each name opens that category's payments of this period, so "where did it go" is one tap
            // from the answer. The first four are shown; "and N more" opens the rest.
            const list = v.categories[lv].map((x) => ({ id: x.category_id, name: (x.category_id ? (() => { const c = data.cats.get(x.category_id); return c ? catName(c) : null; })() : null) ?? t("common.noCategory") }));
            const shown = open ? list : list.slice(0, 4);
            const openCat = (x: { id: string | null; name: string }) => router.push({ pathname: "/transactions", params: { category: x.id ?? "none", name: x.name, from: period.start, to: period.end, accounts: scopeIds.join(","), nonce: String(Date.now()) } });
            return (
              <View key={lv}>
                <View style={styles.legend}>
                  <View style={[styles.swatch, { backgroundColor: ValueRamp[lv] }]} />
                  <Text style={styles.legendName} numberOfLines={1}>{t(`insights.values.level.l${lv}`)}</Text>
                  <Money minor={now.by_level[lv]} currency={v.currency} style={styles.legendMoney} />
                  <Text style={styles.legendPct}>{pct(now.by_level[lv])}%</Text>
                </View>
                {list.length ? (
                  <Text style={styles.legendCats}>
                    {shown.map((x, i) => (
                      <Text key={x.id ?? "none"}>
                        {i > 0 ? ", " : ""}
                        <Text style={styles.catLink} onPress={() => openCat(x)} accessibilityRole="link" accessibilityLabel={t("insights.values.openCategory", { name: x.name })}>{x.name}</Text>
                      </Text>
                    ))}
                    {list.length > shown.length ? <Text style={styles.catLink} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(true); }} accessibilityRole="button">{` ${t("insights.values.more", { count: list.length - shown.length })}`}</Text> : null}
                  </Text>
                ) : null}
              </View>
            );
          })}
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
            ? sub(Math.abs(now.essential_share - first.essential_share) < 0.02 ? t("insights.values.trendSame", { pct: Math.round(first.essential_share * 100) }) : now.essential_share > first.essential_share ? t("insights.values.trendLess", { pct: Math.round(first.essential_share * 100) }) : t("insights.values.trendMore", { pct: Math.round(first.essential_share * 100) }))
            : sub(t("insights.values.sixPeriods"))}
          {v.unmarked_minor > 0 ? sub(t("insights.values.unmarked")) : null}
        </View>
      );
    }
    case "safety_buffer": {
      if (!data.v) return sub(t("insights.chooseAccount"));
      const b = data.v;
      if (b.no_essentials) return (
        <View>
          <Text style={styles.line}>{t("insights.buffer.noEssentials")}</Text>
          {sub(t("insights.buffer.noEssentialsHint"))}
        </View>
      );
      return (
        <View style={{ gap: 6 }}>
          <Text style={styles.big}>{b.months_covered === null ? "—" : t("insights.months", { count: Number(b.months_covered.toFixed(1)) })}</Text>
          {sub(data.name ? t("insights.buffer.covered", { account: data.name }) : t("insights.buffer.coveredThis"))}
          <ProgressBar ratio={b.ratio} color={b.ratio >= 1 ? ValueRamp[3] : ValueRamp[2]} />
          <Text style={styles.line}>
            <Trans k="insights.of" vars={{ have: amt(b.have_minor, b.currency), target: amt(b.target_minor, b.currency) }} tags={strong} />
          </Text>
          {sub(t("insights.buffer.explain", { count: b.months_wanted, amount: amt(b.essential_minor, b.currency), periods: b.periods }))}
        </View>
      );
    }
    case "safe_to_spend": {
      const v = data.v;
      if (!v.safe.length) return sub(t("insights.safe.none"));
      return (
        <View style={{ gap: 6 }}>
          {v.safe.map((m) => <Money key={m.currency} minor={m.minor} currency={m.currency} style={styles.big} />)}
          {sub(t("insights.safe.over", { count: v.days, day: humanDayTime(v.next) }))}
          {v.per_day.map((m) => <Text key={m.currency} style={styles.line}><Trans k="insights.perDay" vars={{ amount: amt(m.minor, m.currency) }} tags={strong} /></Text>)}
          {v.committed.length ? (
            <Text style={styles.sub}>
              {t("insights.safe.less", { free: v.free.map((f) => t("insights.safe.free", { amount: formatMinor(f.minor, f.currency) })).join(" · "), committed: v.committed.map((c) => t("insights.safe.committed", { amount: formatMinor(c.minor, c.currency) })).join(" · ") })}
            </Text>
          ) : sub(t("insights.safe.nothingElse"))}
          {v.short.length ? (
            <Text style={[styles.sub, { color: C.orange }]}>
              {t("insights.safe.short", { amount: v.short.map((m) => amt(m.minor, m.currency)).join(" · ") })}
            </Text>
          ) : null}
        </View>
      );
    }
  }
}

function formatDiff(minor: number, currency: string) { return minor > 0 ? t("insights.goal.toGo", { amount: `${formatMinor(minor, currency)} ${currency}` }) : t("insights.goal.reached"); }

const styles = themed(() => StyleSheet.create({
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
  catLink: { color: C.tint },
  legendCats: { fontSize: 13, color: C.secondary, marginLeft: 10 + S.sm, marginBottom: 2 },
  checkTitle: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  times: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  ruleIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  legendPct: { fontSize: 13, color: C.secondary, width: 38, textAlign: "right", fontVariant: ["tabular-nums"] },
  trendRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 34, marginTop: S.sm },
  trendSlot: { flex: 1, justifyContent: "flex-end" },
  trendBar: { borderRadius: 2 },
}));
