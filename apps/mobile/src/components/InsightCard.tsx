import { useState, type ReactNode } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { animateNextLayout } from "@/lib/motion";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountLeftover, biggestOneOffs, monthVsUsual, spendingPlaces, topShops, categoryChecklist, save, checklistTotals, daysToSalary, formatMinor, freeMoney, getRow, listRows, parseInsightParams, regularSpending, retiredKind, safeToSpend, safetyBuffer, subscriptionsPerYear, valueSplit, withChecklistTick, type Insight, type InsightParams, type ValuePeriod } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { CategoryIcon, Money, PressCard, ProgressBar, TagPill, Tap } from "@/components/ui";
import { PaymentIcon } from "@/components/PaymentIcon";
import { C, S, ValueRamp, themed, themeHue } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { anchorDay, currentPeriod, getPeriodStartDay, usePeriod } from "@/lib/period";
import { getBudgetScope } from "@/lib/settings";
import { INSIGHT_LOOK, kindTitle, ruleTitle } from "@/lib/insights";
import { catName, acctName } from "@/lib/names";
import { rowText } from "@/lib/rowText";
import { t, Trans } from "@/i18n";
import { scopeAccount, scopeAccountIds } from "@/lib/scope";
import { future } from "@/components/future/lazy";

/**
 * One insight card: its heading and what it computes to for the period Budgets and Transactions are
 * showing (`usePeriod` — pick March there and the cards are March's). The Insights screen lists them
 * and a tap opens one (`(tabs)/insights/[id].tsx`, drawn there with `detail`); the editor draws one
 * from the settings being chosen (`preview`), so what Save will add is on screen while it is being
 * set up rather than discovered afterwards.
 *
 * `cat` says whether this card may draw Siriusia: a screen shows her once, so the Insights tab gives
 * her to the first card that wants her and the rest go without (`components/Siriusia.tsx`).
 */
export function InsightCard({ insight, preview, detail, cat = true }: { insight: Insight; preview?: boolean; detail?: boolean; cat?: boolean }) {
  const p = parseInsightParams(insight.params);
  const shownKind = retiredKind(insight.kind) ?? insight.kind;
  const title = p.title || kindTitle(shownKind);
  const look = INSIGHT_LOOK[shownKind];
  const still = preview || detail;
  const head = (
    <View style={styles.head} accessibilityRole={still ? "header" : undefined}>
      {look ? <SymbolView name={look.icon} size={15} tintColor={themeHue(look.color)} weight="semibold" /> : null}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {still ? null : <SymbolView name="chevron.right" size={13} tintColor={C.tertiary} />}
    </View>
  );
  if (still) return <View style={styles.card}>{head}<Body insight={insight} p={p} preview={preview} detail={detail} cat={cat} /></View>;
  // On the Insights tab the whole card is the way in, and answers a touch; the checklist lines and
  // the links inside it are buttons of their own and take the touch first.
  return (
    <PressCard style={styles.card} onPress={() => router.push({ pathname: "/insights/[id]", params: { id: insight.id } })} accessibilityLabel={t("insights.openLabel", { title })}>
      {head}
      <Body insight={insight} p={p} preview={preview} detail={detail} cat={cat} />
    </PressCard>
  );
}

function Body({ insight, p, preview, detail, cat }: { insight: Insight; p: InsightParams; preview?: boolean; detail?: boolean; cat: boolean }) {
  const startDay = useQuery(() => getPeriodStartDay());
  const scope = useQuery(() => getBudgetScope());
  const accounts = useQuery((db) => listRows(db, "accounts", "1=1"));
  const scopeIds = scopeAccountIds(scope, accounts);
  const budgetAccount = scopeAccount(scope);
  const [period] = usePeriod();
  // "As of today" for a period that may not be this one: its last day once it is over (lib/period.ts).
  const day = anchorDay(period);
  const isNow = period.start === currentPeriod(startDay).start;
  const [open, setOpen] = useState(false);
  const data = useQuery((db) => {
    switch (retiredKind(insight.kind)) {
      // What the budgets have left, and — for the period running now — what is still going to be
      // charged out of it before payday. The second half is what "Safe to spend" used to be a card for.
      case "free_money": return { kind: "free_money" as const, v: freeMoney(db, { start: period.start, end: period.end, accountIds: scopeIds, budgetAccount }), safe: isNow ? safeToSpend(db, { today: day, startDay, accountIds: scopeIds, budgetAccount }) : null };
      case "days_to_salary": return { kind: "days_to_salary" as const, v: daysToSalary(db, { today: day, startDay, accountIds: scopeIds, budgetAccount }) };
      case "savings_goal": return { kind: "savings_goal" as const };
      case "account_balance": return { kind: "account_balance" as const, v: accountLeftover(db, p, { start: period.start, end: period.end }) };
      case "checklist": return { kind: "checklist" as const, v: categoryChecklist(db, p, { start: period.start, end: period.end, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])), tags: new Map(listRows(db, "tags", "1=1").map((x) => [x.id, x])), rules: new Map(listRows(db, "recurring_rules", "1=1").map((r) => [r.id, r])) };
      case "subscriptions": return { kind: "subscriptions" as const, v: subscriptionsPerYear(db, p) };
      case "regular": return { kind: "regular" as const, v: regularSpending(db, p, { today: day, accountIds: scopeIds }), names: (p.category_ids ?? []).map((id) => { const c = getRow(db, "categories", id); return c ? catName(c) : null; }).filter(Boolean).join(", ") };
      case "values": return { kind: "values" as const, v: valueSplit(db, { today: day, startDay, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      case "safety_buffer": { const v = safetyBuffer(db, p, { today: day, startDay }); return { kind: "safety_buffer" as const, v, names: (v?.account_ids ?? []).map((id) => acctName(getRow(db, "accounts", id))).filter(Boolean).join(", ") }; }
      case "month_vs_usual": return { kind: "month_vs_usual" as const, v: monthVsUsual(db, { start: period.start, end: period.end, today: day, startDay, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      case "one_offs": return { kind: "one_offs" as const, v: biggestOneOffs(db, { start: period.start, end: period.end, accountIds: scopeIds, limit: detail ? 10 : 3 }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      case "top_shops": return { kind: "top_shops" as const, v: topShops(db, { start: period.start, end: period.end, today: day, startDay, accountIds: scopeIds, limit: detail ? 10 : 3 }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      case "forecast": return { kind: "forecast" as const };
      case "spending_map": return { kind: "spending_map" as const, v: spendingPlaces(db, { start: period.start, end: period.end, accountIds: scopeIds }), cats: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c])) };
      default: return { kind: "gone" as const };
    }
  }, [insight.id, insight.kind, insight.params, period.start, scope, startDay, detail]);
  const sub = (s: string) => <Text style={styles.sub}>{s}</Text>;
  // The Insights tab is for a glance: the number, a bar, the few lines that moved. The sentences
  // that explain them — how it was worked out, what it is compared with, what is left out — are on
  // the details screen, which draws this same card with `detail`.
  const more = (s: string | null | false | undefined) => (detail && s ? sub(s) : null);
  const pn = period.subtitle ?? period.title;
  const strong = { b: (c: ReactNode) => <Text style={styles.lineStrong}>{c}</Text>, g: (c: ReactNode) => <Text style={[styles.lineStrong, { color: C.green }]}>{c}</Text> };
  const amt = (minor: number, currency: string) => `${formatMinor(minor, currency)} ${currency}`;

  switch (data.kind) {
    case "gone":
      return sub(t("insights.gone"));
    case "free_money": {
      const s = data.safe;
      return (
        <View style={{ gap: 2 }}>
          {data.v.length ? data.v.map((m) => <Money key={m.currency} minor={m.minor} currency={m.currency} style={[styles.big, { color: m.minor < 0 ? C.red : C.green }]} />) : sub(t("insights.noBudgets"))}
          {sub(t("insights.free.left", { period: pn }))}
          {/* Only for the period running now: "still to be charged" is about days still to come. */}
          {detail && s && s.committed.length ? <Text style={styles.line}>{t("insights.free.committed", { amount: s.committed.map((c) => amt(c.minor, c.currency)).join(" · "), day: humanDayTime(s.next) })}</Text> : null}
          {s && s.safe.length && s.committed.length ? s.per_day.map((m) => <Text key={m.currency} style={styles.line}><Trans k="insights.free.perDayAfter" vars={{ amount: amt(m.minor, m.currency) }} tags={strong} /></Text>) : null}
          {s && s.short.length ? <Text style={[styles.sub, { color: C.orange }]}>{t("insights.safe.short", { amount: s.short.map((m) => amt(m.minor, m.currency)).join(" · ") })}</Text> : null}
        </View>
      );
    }
    case "days_to_salary":
      return <View><Text style={styles.big}>{t("insights.days", { count: data.v.days })}</Text>{more(t("insights.salary.until", { day: humanDayTime(data.v.next) }))}{data.v.per_day.map((m) => <Text key={m.currency} style={styles.line}><Trans k="insights.perDay" vars={{ amount: amt(m.minor, m.currency) }} tags={strong} /></Text>)}</View>;
    case "savings_goal": {
      // Siriusia's verdict, the bar with its quarter marks, and when it gets there (components/future/Goal.tsx).
      const { GoalCardBody } = future();
      return <GoalCardBody p={p} cat={cat} />;
    }
    case "forecast": {
      const { PurrphecyCardBody } = future();
      return <PurrphecyCardBody insight={insight} cat={cat} />;
    }
    case "account_balance": {
      if (!data.v) return sub(t("insights.chooseAccount"));
      const a = data.v;
      const waiting = a.with_pending_minor - a.balance_minor;
      return <View>
        <Money minor={a.balance_minor} currency={a.currency} style={[styles.big, { color: a.balance_minor < 0 ? C.red : C.label }]} />
        {more(waiting ? t("insights.balance.leftPending", { account: acctName(a), amount: formatMinor(a.with_pending_minor, a.currency) }) : t("insights.balance.left", { account: acctName(a) }))}
        <Text style={styles.line}>
          <Trans k="insights.balance.inOut" vars={{ income: amt(a.in_minor, a.currency), spent: amt(a.out_minor, a.currency) }} tags={strong} />
        </Text>
        {more(period.subtitle ?? period.title)}
      </View>;
    }
    case "checklist": {
      // The card is what is still to pay: those lines only, and one small line per currency of roughly
      // what they will cost (the open lines' last payment, or the rule's amount for each time it is
      // still due). What was paid — the lines, the amounts, the sum with it — is on the details
      // screen, which lists every line with its tick; the card only counts the paid ones.
      const open = data.v.filter((c) => !c.done);
      const paid = data.v.length - open.length;
      const lines = detail ? data.v : open;
      const left = detail ? [] : checklistTotals(data.v).filter((x) => x.expected_minor);
      // Everything paid is news worth a moment of its own: a seal, "All paid", and what it came to.
      const allPaid = data.v.length > 0 && !open.length;
      const paidSums = allPaid ? checklistTotals(data.v).filter((x) => x.paid_minor).map((x) => amt(x.paid_minor, x.currency)) : [];
      return <View style={{ gap: 4 }}>
        {allPaid ? (
          <View style={styles.allPaid} accessible accessibilityLabel={[t("insights.checklist.allDone"), t("insights.checklist.allDoneSub", { count: data.v.length, period: pn }), ...paidSums].join(", ")}>
            <SymbolView name="checkmark.seal.fill" size={36} tintColor={C.green} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.allPaidTitle}>{t("insights.checklist.allDone")}</Text>
              <Text style={styles.sub}>{[t("insights.checklist.allDoneSub", { count: data.v.length, period: pn }), ...paidSums].join(" · ")}</Text>
            </View>
          </View>
        ) : null}
        {left.map((x) => <Text key={x.currency} style={styles.sub}>{t("insights.checklist.summaryLeft", { amount: amt(x.expected_minor, x.currency) })}</Text>)}
        {data.v.length ? lines.map((c) => {
        const cat = data.cats.get(c.category_id);
        const rule = c.rule_id ? data.rules.get(c.rule_id) : undefined;
        const tag = c.tag_id ? data.tags.get(c.tag_id) : undefined;
        const name = rule ? ruleTitle(rule) : cat ? catName(cat) : c.name;
        const openLog = () => {
          // A recurring line goes to its rule: confirming the occurrence once it is due, the rule itself before.
          if (rule) { router.push(c.due && c.due <= todayLocal() ? { pathname: "/recurring/confirm", params: { id: rule.id } } : { pathname: "/recurring/[id]", params: { id: rule.id } }); return; }
          const last = c.last;
          const tags = last ? last.tag_ids.join(",") : c.tag_id ?? "";
          if (last) router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id, amount: formatMinor(Math.abs(last.amount_minor), last.currency, { grouping: "", decimal: "." }), kind: last.amount_minor >= 0 ? "income" : "expense", note: last.notes ?? "", tags, account: last.account_id } });
          else router.push({ pathname: "/transaction/[id]", params: { id: "new", category: c.category_id, ...(tags ? { tags } : {}) } });
        };
        const label = tag ? `${name} #${tag.name}` : name;
        // Ticked by hand: kept on the insight for this period only (core `withChecklistTick`).
        const tick = (on: boolean) => mutate((d) => save(d, "insights", { ...insight, params: JSON.stringify(withChecklistTick(p, period.start, c.key, on)) }));
        // An open line asks: log the payment, or tick it off without one — paid in cash, settled by
        // someone else, not needed this time. A line ticked by hand unticks with a tap; one a payment
        // closed is the payment's and does nothing.
        const press = () => {
          if (c.ticked) { if (!preview) tick(false); return; }
          if (c.done) return;
          if (preview) { openLog(); return; }
          Alert.alert(label, t("insights.checklist.askBody"), [
            { text: t("insights.checklist.askLog"), onPress: openLog },
            { text: t("insights.checklist.askTick"), onPress: () => tick(true) },
            { text: t("common.cancel"), style: "cancel" },
          ]);
        };
        // A payment due several times this period (weekly lessons) shows how many of them are paid.
        const times = c.occurrences && c.occurrences.total > 1 ? c.occurrences : null;
        const hint = !c.done
          ? rule ? (c.due ? t("insights.checklist.due", { amount: amt(Math.abs(rule.amount_minor), c.currency ?? ""), day: humanDayTime(c.due) }) : null)
            // Paid several times last month (lessons, the pharmacy): the month's total says more than its last payment.
            : c.previous ? t("insights.checklist.lastMonth", { amount: amt(c.previous.total_minor, c.previous.currency), count: c.previous.count })
            : c.last ? t("insights.checklist.last", { amount: amt(Math.abs(c.last.amount_minor), c.last.currency), day: humanDayTime(c.last.date.slice(0, 10)) }) : null
          : c.ticked ? t("insights.checklist.ticked")
          // Done, and paid more than once already, or a line that usually is: what it has come to so far.
          : !rule && c.currency && c.spent_minor && c.previous ? t("insights.checklist.paid", { amount: amt(c.spent_minor, c.currency) }) : null;
        return <Tap key={c.key} onPress={press} style={styles.check} accessibilityRole="button" accessibilityLabel={c.ticked ? t("insights.checklist.tickedLabel", { name: label }) : c.done ? t("insights.checklist.doneLabel", { name: label }) : t("insights.checklist.notYetLabel", { name: label })}>
          {/* The tick is for the details screen, where paid lines are listed too; on the card every line is an open one. */}
          {detail ? <SymbolView name={c.ticked ? "checkmark.circle" : c.done ? "checkmark.circle.fill" : "circle"} size={22} tintColor={c.done ? C.green : C.tertiary} /> : null}
          {/* A payment wears its own mark with its category as a badge; a category line just its icon. */}
          {rule ? <PaymentIcon icon={c.icon} category={cat ? { name: catName(cat), icon: cat.icon, color: cat.color } : null} size={32} /> : <CategoryIcon name={name} icon={cat?.icon} color={cat?.color} size={30} />}
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
            {detail && hint ? <Text style={styles.sub}>{hint}</Text> : null}
          </View>
          {detail && c.spent_minor && c.currency && (c.done || times) ? <Money minor={-c.spent_minor} currency={c.currency} style={styles.sub} /> : null}
        </Tap>;
      }) : sub(t("insights.checklist.choose"))}
        {!data.v.length || !open.length ? null : !detail && paid ? sub(t("insights.checklist.paidCount", { count: paid })) : null}</View>;
    }
    case "subscriptions": {
      // The payments themselves are on the details screen, where there is room for every one of them.
      const included = data.v.lines.filter((l) => l.included);
      return <View>{data.v.totals.map((x) => <Money key={x.currency} minor={x.minor} currency={x.currency} style={styles.big} />)}{more(t("insights.subscriptions.perYear", { included: included.length, count: data.v.lines.length }))}
        {data.v.totals.map((x) => <Text key={x.currency} style={styles.line}><Trans k="insights.subscriptions.perMonth" vars={{ amount: amt(Math.round(x.minor / 12), x.currency) }} tags={strong} /></Text>)}</View>;
    }
    case "regular":
      return <View>{data.v.length ? data.v.map((r) => <View key={r.currency}><Money minor={r.average_minor} currency={r.currency} style={styles.big} />{sub(r.frequency === "weekly" ? t("insights.regular.weekly", { names: data.names, last: amt(r.last_minor, r.currency) }) : t("insights.regular.monthly", { names: data.names, last: amt(r.last_minor, r.currency) }))}{p.window_months ? more(t("insights.regular.window", { count: p.window_months })) : null}</View>) : sub(t("insights.regular.choose"))}</View>;
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
            // Every name on the details screen; on the card the first four, and "and N more" opens the rest.
            const shown = open || detail ? list : list.slice(0, 4);
            const openCat = (x: { id: string | null; name: string }) => router.push({ pathname: "/transactions", params: { category: x.id ?? "none", name: x.name, from: period.start, to: period.end, accounts: scopeIds.join(","), nonce: String(Date.now()) } });
            return (
              <View key={lv}>
                <View style={styles.legend}>
                  <View style={[styles.swatch, { backgroundColor: ValueRamp[lv] }]} />
                  <Text style={styles.legendName} numberOfLines={1}>{t(`insights.values.level.l${lv}`)}</Text>
                  <Money minor={now.by_level[lv]} currency={v.currency} style={styles.legendMoney} />
                  <Text style={styles.legendPct}>{pct(now.by_level[lv])}%</Text>
                </View>
                {detail && list.length ? (
                  <Text style={styles.legendCats}>
                    {shown.map((x, i) => (
                      <Text key={x.id ?? "none"}>
                        {i > 0 ? ", " : ""}
                        <Text style={styles.catLink} onPress={() => openCat(x)} accessibilityRole="link" accessibilityLabel={t("insights.values.openCategory", { name: x.name })}>{x.name}</Text>
                      </Text>
                    ))}
                    {list.length > shown.length ? <Text style={styles.catLink} onPress={() => { animateNextLayout(); setOpen(true); }} accessibilityRole="button">{` ${t("insights.values.more", { count: list.length - shown.length })}`}</Text> : null}
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
          {!detail ? null : first && first !== now && first.essential_share !== null && now.essential_share !== null
            ? sub(Math.abs(now.essential_share - first.essential_share) < 0.02 ? t("insights.values.trendSame", { pct: Math.round(first.essential_share * 100) }) : now.essential_share > first.essential_share ? t("insights.values.trendLess", { pct: Math.round(first.essential_share * 100) }) : t("insights.values.trendMore", { pct: Math.round(first.essential_share * 100) }))
            : sub(t("insights.values.sixPeriods"))}
          {v.unmarked_minor > 0 ? more(t("insights.values.unmarked")) : null}
        </View>
      );
    }
    case "month_vs_usual": {
      const v = data.v[0];
      if (!v) return sub(t("insights.usual.nothing"));
      const r = v.usual_minor ? (v.now_minor - v.usual_minor) / v.usual_minor : null;
      // On the card only what actually moved: a tenth either way, or spending that is new.
      const lines = detail ? v.lines : v.lines.filter((l) => l.ratio === null || Math.abs(l.ratio) >= 0.1).slice(0, 3);
      return (
        <View style={{ gap: 4 }}>
          <Text style={[styles.big, r !== null && Math.abs(r) >= 0.03 && { color: r > 0 ? C.orange : C.green }]}>{r === null ? amt(v.now_minor, v.currency) : Math.abs(r) < 0.03 ? t("insights.usual.same") : pctChange(r)}</Text>
          {more(t(v.partial ? "insights.usual.soFar" : "insights.usual.whole", { amount: amt(v.now_minor, v.currency), usual: amt(v.usual_minor, v.currency) }))}
          {lines.map((l) => {
            const cat = data.cats.get(l.category_id);
            const name = cat ? catName(cat) : t("common.noCategory");
            const change = l.ratio === null ? t("insights.usual.new") : pctChange(l.ratio);
            const up = l.diff_minor > 0;
            return (
              <Tap key={l.category_id} style={styles.check} accessibilityRole="button" accessibilityLabel={t("insights.usual.lineA11y", { name, amount: amt(l.now_minor, v.currency), change })}
                onPress={() => router.push({ pathname: "/transactions", params: { category: l.category_id, name, from: period.start, to: period.end, accounts: scopeIds.join(","), nonce: String(Date.now()) } })}>
                <CategoryIcon name={name} icon={cat?.icon} color={cat?.color} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.line} numberOfLines={1}>{name}</Text>
                  {more(`${amt(l.now_minor, v.currency)} · ${amt(l.usual_minor, v.currency)}`)}
                </View>
                <Text style={[styles.lineStrong, { color: up ? C.orange : C.green }]}>{change}</Text>
              </Tap>
            );
          })}
        </View>
      );
    }
    case "one_offs": {
      const v = data.v[0];
      if (!v) return sub(t("insights.oneOffs.nothing"));
      return (
        <View style={{ gap: 4 }}>
          {v.rows.map((r) => {
            const cat = r.category_id ? data.cats.get(r.category_id) : undefined;
            const title = rowText(r).title ?? (cat ? catName(cat) : t("insights.oneOffs.untitled"));
            const when = humanDayTime(r.date.slice(0, 10));
            return (
              <Tap key={r.id} style={styles.check} onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: r.id } })}
                accessibilityRole="button" accessibilityLabel={t("insights.oneOffs.openA11y", { title, amount: amt(-r.amount_minor, v.currency), day: when })}>
                <CategoryIcon name={cat ? catName(cat) : title} icon={cat?.icon} color={cat?.color} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.line} numberOfLines={1}>{title}</Text>
                  {detail ? <Text style={styles.sub} numberOfLines={1}>{cat ? `${when} · ${catName(cat)}` : when}</Text> : null}
                </View>
                <Money minor={-r.amount_minor} currency={v.currency} style={styles.lineStrong} />
              </Tap>
            );
          })}
        </View>
      );
    }
    case "top_shops": {
      const v = data.v[0];
      if (!v) return sub(t("insights.shops.nothing"));
      return (
        <View style={{ gap: 4 }}>
          {v.shops.map((s) => {
            const cat = s.category_id ? data.cats.get(s.category_id) : undefined;
            const r = s.prev_minor ? (s.spent_minor - s.prev_minor) / s.prev_minor : null;
            return (
              <View key={s.key} style={styles.check}>
                <CategoryIcon name={cat ? catName(cat) : s.name} icon={cat?.icon} color={cat?.color} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.line} numberOfLines={1}>{s.name}</Text>
                  {more(t("insights.shops.count", { count: s.count }))}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Money minor={s.spent_minor} currency={v.currency} style={styles.lineStrong} />
                  <Text style={[styles.sub, r !== null && Math.abs(r) >= 0.03 && { color: r > 0 ? C.orange : C.green }]}>{r === null ? t("insights.shops.new") : Math.abs(r) < 0.03 ? "=" : pctChange(r)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      );
    }
    case "spending_map": {
      const v = data.v[0];
      if (!v) return sub(t("insights.map.nothing"));
      // The map itself is on the details screen; the card names where most of it went.
      const shown = detail ? [] : v.places.slice(0, 3);
      return (
        <View style={{ gap: 4 }}>
          {shown.map((pl) => {
            const cat = pl.category_id ? data.cats.get(pl.category_id) : undefined;
            const name = pl.place ?? t("insights.map.unnamed");
            return (
              <View key={pl.key} style={styles.check}>
                <CategoryIcon name={cat ? catName(cat) : name} icon={cat?.icon ?? "mappin"} color={cat?.color} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.line} numberOfLines={1}>{name}</Text>
                  {more(t("insights.shops.count", { count: pl.count }))}
                </View>
                <Money minor={pl.spent_minor} currency={v.currency} style={styles.lineStrong} />
              </View>
            );
          })}
          {more(t("insights.map.located", { pct: v.total_minor ? Math.round((v.located_minor / v.total_minor) * 100) : 0 }))}
        </View>
      );
    }
    case "safety_buffer": {
      if (!data.v) return sub(t("insights.chooseAccount"));
      const b = data.v;
      if (b.no_essentials) return (
        <View>
          <Text style={styles.line}>{t("insights.buffer.noEssentials")}</Text>
          {more(t("insights.buffer.noEssentialsHint"))}
        </View>
      );
      // Which accounts are counted is the card's settings, not its news: the detail screen says it,
      // where there is room, and not every glance at the card.
      const goal = b.months_wanted > 0;
      return (
        <View style={{ gap: 6 }}>
          <Text style={styles.big}>{b.months_covered === null ? "—" : t("insights.months", { count: Number(b.months_covered.toFixed(1)) })}</Text>
          {more(t(b.basis === "chosen" ? "insights.buffer.liveChosenPlain" : "insights.buffer.liveImportantPlain"))}
          {goal ? <ProgressBar ratio={b.ratio} color={b.ratio >= 1 ? ValueRamp[3] : ValueRamp[2]} /> : null}
          {goal ? (
            <Text style={styles.line}>
              <Trans k="insights.of" vars={{ have: amt(b.have_minor, b.currency), target: amt(b.target_minor, b.currency) }} tags={strong} />
            </Text>
          ) : null}
          {!detail ? null : goal
            ? sub(t(b.basis === "chosen" ? "insights.buffer.explainChosen" : "insights.buffer.explain", { count: b.months_wanted, amount: amt(b.essential_minor, b.currency), periods: b.periods }))
            : sub(t("insights.buffer.monthCosts", { amount: amt(b.essential_minor, b.currency), periods: b.periods }))}
          {b.extra_pct ? more(t("insights.buffer.cushion", { pct: b.extra_pct, amount: amt(b.base_minor, b.currency) })) : null}
          {more(t("insights.buffer.accounts", { accounts: data.names, amount: amt(b.have_minor, b.currency) }))}
          {b.missing.length ? <Text style={[styles.sub, { color: C.orange }]}>{t("insights.buffer.noRate", { currencies: b.missing.join(", ") })}</Text> : null}
        </View>
      );
    }
  }
}

/** "+38%" / "−12%": a change against the usual, rounded to a whole percent. */
function pctChange(r: number): string { return `${r > 0 ? "+" : "−"}${Math.round(Math.abs(r) * 100)}%`; }


const styles = themed(() => StyleSheet.create({
  card: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 16, padding: S.lg, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.3 },
  big: { fontSize: 30, fontWeight: "700", color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  line: { fontSize: 15, color: C.label },
  lineStrong: { fontSize: 15, fontWeight: "600", color: C.label },
  check: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 44 },
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
  legendPct: { fontSize: 13, color: C.secondary, width: 38, textAlign: "right", fontVariant: ["tabular-nums"] },
  trendRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 34, marginTop: S.sm },
  trendSlot: { flex: 1, justifyContent: "flex-end" },
  trendBar: { borderRadius: 2 },
  allPaid: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.xs },
  allPaidTitle: { fontSize: 22, fontWeight: "700", color: C.green },
}));
