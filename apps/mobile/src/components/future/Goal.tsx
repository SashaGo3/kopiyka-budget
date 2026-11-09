import { StyleSheet, Text, View, type ColorValue } from "react-native";
import { getRow, goalForecast, monthAfter, monthsBetween, type GoalForecast, type InsightParams } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Row, SectionHeader } from "@/components/ui";
import { LineChart } from "@/components/FutureChart";
import { Siriusia, goalMood } from "@/components/Siriusia";
import { whole } from "@/components/future/Purrphecy";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, monthPill, todayLocal } from "@/lib/dates";
import { getPeriodStartDay } from "@/lib/period";
import { acctName } from "@/lib/names";
import { t } from "@/i18n";

/**
 * A savings goal with Siriusia watching it. The card is how far it has got — a bar with its quarter
 * marks — and her verdict: done, on track for the deadline, behind it (and what it would take), or
 * not moving. The details add the road there: the balance so far, carried forward at your pace to
 * the target, the milestones, and how much sooner a little more each month gets you.
 *
 * The pace is the account's own average month (core `goalForecast`): no interest, no promises —
 * what you actually did, carried forward.
 */

const money = (minor: number, currency: string) => `${whole(minor, currency)} ${currency}`;

function useGoal(p: InsightParams): { g: GoalForecast | null; name: string } {
  const startDay = useQuery(() => getPeriodStartDay());
  return useQuery((d) => ({
    g: goalForecast(d, p, { today: todayLocal(), startDay }),
    name: p.account_id ? acctName(getRow(d, "accounts", p.account_id)) ?? "" : "",
  }), [JSON.stringify(p), startDay]);
}

/** What Siriusia says about a goal, in one line. */
export function goalVerdict(g: GoalForecast): string {
  const cur = g.currency;
  const left = g.target_minor - g.balance_minor;
  switch (g.status) {
    case "done": return t("future.goal.done");
    case "on_track": return t("future.goal.onTrack", { when: monthPill(g.eta!), deadline: humanDayTime(g.deadline!, null, todayLocal(), true) });
    case "behind":
      return g.months_to_deadline! <= 0
        ? t("future.goal.overdue", { amount: money(left, cur) })
        : t("future.goal.behind", { need: money(g.need_minor!, cur), pace: money(Math.max(0, g.pace_minor ?? 0), cur) });
    case "stalled":
      return g.deadline && g.need_minor ? t("future.goal.stalledBy", { need: money(g.need_minor, cur), deadline: humanDayTime(g.deadline, null, todayLocal(), true) }) : t("future.goal.stalled");
    default: return t("future.goal.open", { when: monthPill(g.eta!), pace: money(g.pace_minor!, cur) });
  }
}

function statusColor(g: GoalForecast): ColorValue {
  return g.status === "done" || g.status === "on_track" ? C.green : g.status === "behind" ? C.orange : C.secondary;
}

/** The goal's bar, with a tick at every quarter: the milestones are what keeps a long goal going. */
function GoalBar({ ratio, color }: { ratio: number; color: ColorValue }) {
  return (
    <View style={styles.bar}>
      <View style={[styles.barFill, { width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`, backgroundColor: color }]} />
      {[0.25, 0.5, 0.75].map((q) => <View key={q} style={[styles.tick, { left: `${q * 100}%` }, ratio >= q && { backgroundColor: C.card }]} />)}
    </View>
  );
}

export function GoalCardBody({ p }: { p: InsightParams }) {
  const { g, name } = useGoal(p);
  if (!g) return <Text style={styles.sub}>{t("insights.chooseAccount")}</Text>;
  const color = g.ratio >= 1 ? C.green : C.tint;
  return (
    <View style={styles.row}>
      <Siriusia mood={goalMood(g.status)} size={60} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.sub} numberOfLines={1}>{name}{g.deadline ? ` · ${t("future.goal.by", { deadline: humanDayTime(g.deadline, null, todayLocal(), true) })}` : ""}</Text>
        <Text style={styles.line} numberOfLines={1} adjustsFontSizeToFit>
          <Text style={styles.strong}>{money(g.balance_minor, g.currency)}</Text>{` ${t("future.goal.of", { target: money(g.target_minor, g.currency) })}`}
        </Text>
        <GoalBar ratio={g.ratio} color={color} />
        <Text style={[styles.sub, { color: statusColor(g) }]}>{`${Math.round(g.ratio * 100)}% · ${goalVerdict(g)}`}</Text>
      </View>
    </View>
  );
}

/**
 * The forecast sections at the top of a goal's details; the balance history follows them. Siriusia and
 * her verdict are not repeated here: the card drawn above these sections already says them.
 */
export function GoalDetails({ p, hue }: { p: InsightParams; hue: ColorValue }) {
  const { g } = useGoal(p);
  if (!g || g.target_minor <= 0) return null;
  const cur = g.currency;
  const today = todayLocal();
  const left = Math.max(0, g.target_minor - g.balance_minor);
  const pace = g.pace_minor ?? 0;
  // The road: the balance so far, then the pace carried forward to the target (or the deadline, when
  // that is later), never more than five years out.
  const past = g.history.length ? g.history.map((x) => x.balance_minor) : [g.balance_minor];
  past[past.length - 1] = g.balance_minor;
  const ahead = Math.min(60, Math.max(g.months_left ?? 0, g.months_to_deadline ?? 0, 3) + 1);
  const proj = pace > 0 && left > 0 ? Array.from({ length: ahead + 1 }, (_, k) => Math.min(g.target_minor * 1.1, g.balance_minor + pace * k)) : [];
  const base = g.history[0]?.start ?? today;
  const monthOf = (i: number) => (i < past.length ? g.history[i]?.start ?? today : monthAfter(today, i - past.length + 1));
  const valueAt = (i: number) => (i < past.length ? past[i]! : proj[i - past.length + 1] ?? null);
  const boosts = pace > 0 && left > 0 ? [10, 25, 50].map((x) => ({ x, months: Math.ceil(left / (pace * (1 + x / 100))) })) : [];
  const extraForDeadline = g.status === "behind" && g.need_minor && g.months_to_deadline! > 0 ? Math.max(0, g.need_minor - Math.max(0, pace)) : 0;
  return (
    <>
      <SectionHeader>{t("future.goal.road")}</SectionHeader>
      <Card>
        <LineChart currency={cur} height={110}
          series={[
            { key: "past", color: hue, values: past, fill: true, width: 3 },
            ...(proj.length ? [{ key: "ahead", color: hue, values: proj, dashed: true, offset: past.length - 1 }] : []),
          ]}
          target={{ minor: g.target_minor, color: C.green, label: t("future.goal.target") }}
          describe={(i) => { const v = valueAt(i); return v === null ? " " : t(i < past.length ? "future.goal.atPast" : "future.goal.atAhead", { month: monthPill(monthOf(i)), amount: money(v, cur) }); }}
          startLabel={monthPill(base)} endLabel={proj.length ? monthPill(monthAfter(today, ahead)) : t("future.now")} />
      </Card>
      <SectionHeader>{t("insights.detail.goal")}</SectionHeader>
      <Card>
        <Row title={t("insights.detail.target")} right={<Text style={styles.amount}>{money(g.target_minor, cur)}</Text>} />
        <Row title={left > 0 ? t("insights.detail.toGo") : t("insights.detail.reached")} right={<Text style={[styles.amount, left <= 0 && { color: C.green }]}>{money(left > 0 ? left : g.balance_minor - g.target_minor, cur)}</Text>} style={styles.divider} />
        {g.pace_minor !== null ? <Row title={t("future.goal.pace")} right={<Text style={[styles.amount, { color: pace > 0 ? C.green : C.red }]}>{money(pace, cur)}</Text>} style={styles.divider} /> : null}
        {g.deadline ? <Row title={t("future.goal.deadline")} subtitle={g.months_to_deadline! > 0 ? t("future.goal.monthsLeft", { count: g.months_to_deadline! }) : undefined} right={<Text style={styles.amount}>{humanDayTime(g.deadline, null, today, true)}</Text>} style={styles.divider} /> : null}
        {g.deadline && left > 0 && g.need_minor ? <Row title={t("future.goal.need")} right={<Text style={[styles.amount, { color: statusColor(g) }]}>{money(g.need_minor, cur)}</Text>} style={styles.divider} /> : null}
        {left > 0 ? <Row title={t("insights.detail.eta")} right={<Text style={styles.amount}>{g.eta ? monthPill(g.eta) : t("insights.detail.etaNever")}</Text>} style={styles.divider} /> : null}
      </Card>
      {boosts.length || extraForDeadline ? (
        <>
          <SectionHeader>{t("future.goal.sooner")}</SectionHeader>
          <Card>
            {extraForDeadline ? <Row icon="target" iconColor="#FF9F0A" title={t("future.goal.forDeadline", { amount: money(extraForDeadline, cur) })} /> : null}
            {boosts.map((b, i) => (
              <Row key={b.x} icon="hare" iconColor="#34C759" title={t("future.goal.boost", { amount: money(Math.round((pace * b.x) / 100), cur) })}
                subtitle={t("future.goal.boostSub", { when: monthPill(monthAfter(today, b.months)), count: Math.max(0, (g.months_left ?? b.months) - b.months) })}
                style={i || extraForDeadline ? styles.divider : undefined} />
            ))}
          </Card>
        </>
      ) : null}
      <SectionHeader>{t("future.milestones")}</SectionHeader>
      <Card>
        {g.milestones.map((m, i) => (
          <Row key={m.pct} icon={m.reached ? "checkmark.seal.fill" : "seal"} iconColor={m.reached ? "#34C759" : "#8E8E93"} title={t("future.goal.milestone", { pct: m.pct, amount: money(m.minor, cur) })}
            subtitle={m.reached ? t("future.goal.reachedIn", { when: monthPill(m.reached) }) : m.eta ? t("future.goal.etaIn", { when: monthPill(m.eta), count: Math.max(1, monthsBetween(today, m.eta) + 1) }) : t("future.never")}
            style={i ? styles.divider : undefined} />
        ))}
      </Card>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: S.md },
  sub: { fontSize: 13, color: C.secondary },
  line: { fontSize: 15, color: C.secondary },
  strong: { fontSize: 17, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  amount: { fontSize: 16, fontWeight: "600", color: C.label, fontVariant: ["tabular-nums"] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  bar: { height: 10, borderRadius: 5, backgroundColor: C.fill, overflow: "hidden", marginVertical: 2 },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5 },
  tick: { position: "absolute", top: 2, bottom: 2, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: C.separator },
}));
