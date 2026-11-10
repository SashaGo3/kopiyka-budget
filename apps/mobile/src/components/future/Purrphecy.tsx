import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Host, Slider } from "@expo/ui/swift-ui";
import {
  categoryImportance, categorySpend, convertMinor, createInsight, crossoverYear, currencyDecimals, doublingYears, formatMinor, freedomNumber, futureInputs, getRow, growth, listRows, monthAfter, monthsToTarget,
  moneyPace, mortgage, numberFormat, paceIn, parseInsightParams, periodWindows, realValue, roundNice, save, setMeta, type Category, type FutureInputs, type Insight, type MoneyPace,
} from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Chip, PressCard, ProgressBar, Row, SectionHeader, Tap, ToggleRow } from "@/components/ui";
import { Legend, LineChart, StackChart } from "@/components/FutureChart";
import { Siriusia, SiriusiaSays, type SiriusiaMood } from "@/components/Siriusia";
import { C, S, themed, themeHue } from "@/constants/theme";
import { monthPill, todayLocal } from "@/lib/dates";
import { getPeriodStartDay } from "@/lib/period";
import { acctName, catName } from "@/lib/names";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { t, Trans } from "@/i18n";

/**
 * Purrphecy ("Siriusia sees the future"): she looks into your money's future. The card says one
 * thing — where your own pace takes you in a number of years, and how much of that the market would
 * add — and opens to six calculators, each a question people actually ask, each answered first in one
 * sentence by the one Siriusia on the screen:
 *
 * - **You**: your balance and your average month, carried forward three ways (mattress, deposit,
 *   invested), with what saving a little more, or starting a year later, changes.
 * - **Compound interest**: any start and monthly amount, the columns showing what you put in against
 *   what grew on top, the year the growth overtakes the deposits, how fast money doubles.
 * - **A home**: when the down payment is there, what the mortgage costs, what overpaying saves.
 * - **Freedom**: the pot that pays for your year forever (the 4% rule), and when you get there.
 * - **Small habits**: a category you could cut, invested instead.
 * - **Inflation**: what your money buys later, and what keeps up.
 *
 * Everything is in one currency: each account's money and average month converted into the one the
 * card speaks (core `paceIn`) — a salary in dollars and a life in złoty is one person saving, not one
 * currency losing money. What the forecast starts from — which accounts, the currency, what you have,
 * what you put away a month — is the first card of "You", each value saying whether it is read from
 * your money or was set by you.
 *
 * Every slider recomputes on the spot; what it was left at is written into the card's `params`
 * (`future`, core `FutureInputs`), so the card opens next time — and on the other phone — as left.
 * Nothing here touches a transaction: a forecast reads, it never writes money.
 */

type Inputs = ReturnType<typeof futureInputs>;

/** The decimals are noise on a number this far ahead: "1 234 568", never "1 234 567.89". */
export function whole(minor: number, currency: string): string {
  const d = currencyDecimals(currency), unit = 10 ** d;
  const s = formatMinor(Math.round(minor / unit) * unit, currency);
  return d ? s.slice(0, -(d + 1)) : s;
}
const money = (minor: number, currency: string) => `${whole(minor, currency)} ${currency}`;
/** "7%", "7.5%", "7.25%" — with the language's decimal mark. */
const pct = (x: number) => `${decimal(x)}%`;
function decimal(x: number): string {
  const s = Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
  return s.replace(".", numberFormat().decimal);
}

type Rate = (from: string, to: string) => number | null;
type Pace = (MoneyPace & { missing: string[] }) | null;

/** Your pace in one currency, and a rate lookup into it (fetching what is missing, in the background). */
function usePace(future: FutureInputs | undefined): { pace: Pace; currency: string; rateFor: Rate } {
  const startDay = useQuery(() => getPeriodStartDay());
  const base = useQuery(() => getBaseCurrency());
  const ids = future?.account_ids ?? [];
  const paces = useQuery((d) => moneyPace(d, { today: todayLocal(), startDay, accountIds: ids }), [startDay, ids.join(",")]);
  const currency = future?.currency ?? base;
  const { rateFor } = useRates(paces.map((x) => x.currency), currency);
  return { pace: paceIn(paces, currency, rateFor), currency, rateFor };
}

/** Your pace and the card's inputs, with a way to change them. */
function useFuture(insight: Insight) {
  const p = parseInsightParams(insight.params);
  const { pace, currency, rateFor } = usePace(p.future);
  const f = futureInputs({ ...p.future, currency }, pace);
  const set = useCallback((patch: Partial<FutureInputs>) => {
    if (insight.id === "preview") return;
    mutate((d) => {
      const row = getRow(d, "insights", insight.id) as Insight | undefined;
      if (!row) return;
      const cur = parseInsightParams(row.params);
      save(d, "insights", { ...row, params: JSON.stringify({ ...cur, future: { ...cur.future, ...patch } }) });
    });
  }, [insight.id]);
  return { pace, f, set, rateFor, own: p.future ?? {} };
}

/** Enough to say something: a month or more of money, or money already there. */
const known = (pace: Pace): pace is NonNullable<Pace> => !!pace && (pace.periods > 0 || pace.balance_minor !== 0);

/** Your money three ways, year by year: kept in cash, on a deposit, invested. */
function threePaths(f: Inputs, start: number, monthly: number, real: boolean) {
  const run = (rate: number) => growth({ start_minor: start, monthly_minor: monthly, rate_pct: rate, years: f.years, inflation_pct: f.inflation_pct });
  const pick = (g: ReturnType<typeof growth>) => g.map((y) => (real ? y.real_minor : y.total_minor));
  const mattress = run(0), deposit = run(f.deposit_pct), market = run(f.rate_pct);
  return { mattress: pick(mattress), deposit: pick(deposit), market: pick(market), put: mattress[mattress.length - 1]!.contributed_minor };
}

/* ── The card ─────────────────────────────────────────────────────────────────────────────── */

/** The card on the Insights tab. `cat` is false when another card on the screen already shows her. */
export function PurrphecyCardBody({ insight, cat = true }: { insight: Insight; cat?: boolean }) {
  const { pace, f } = useFuture(insight);
  if (!known(pace) && !f.start_minor && !f.monthly_minor) {
    return <View style={styles.cardRow}>{cat ? <Siriusia mood="sleep" size={64} /> : null}<Text style={[styles.sub, { flex: 1 }]}>{t("future.card.noData")}</Text></View>;
  }
  const cur = f.currency;
  const paths = threePaths(f, f.start_minor, f.monthly_minor, false);
  const end = paths.market[paths.market.length - 1]!;
  const mattress = paths.mattress[paths.mattress.length - 1]!;
  const losing = !f.monthly_minor && (pace?.net_minor ?? 0) < 0;
  return (
    <View>
      <View style={styles.cardRow}>
        {cat ? <Siriusia mood={losing ? "behind" : "seer"} size={64} float /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.sub}>{t("future.card.in", { count: f.years })}</Text>
          <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>{money(end, cur)}</Text>
          <Text style={styles.line}>
            {losing
              ? t("future.card.negative", { amount: money(-(pace?.net_minor ?? 0), cur) })
              : <Trans k="future.card.grew" vars={{ rate: pct(f.rate_pct), grew: money(end - mattress, cur) }} tags={strong} />}
          </Text>
        </View>
      </View>
      <View pointerEvents="none" style={{ marginHorizontal: -S.lg, marginBottom: -S.sm }}>
        <LineChart currency={cur} height={44} interactive={false} series={[
          { key: "m", color: C.secondary, values: paths.mattress, dashed: true, width: 1.5 },
          { key: "d", color: themeHue("#FF9F0A"), values: paths.deposit, width: 2 },
          { key: "x", color: C.tint, values: paths.market, fill: true },
        ]} />
      </View>
    </View>
  );
}

/**
 * The way in, on the Insights tab, until there is a Purrphecy card or it is waved away: your own
 * number, a tap from the screen that explains it. The tap adds the card first in the list and opens
 * it; the cross remembers the answer (`meta.forecast_promo`, travels with backups — DATA.md rule 7).
 */
export function PurrphecyPromo({ cat = true }: { cat?: boolean }) {
  const { pace, currency } = usePace(undefined);
  const f = futureInputs({ currency }, pace);
  const end = known(pace) && f.monthly_minor > 0 ? growth({ start_minor: f.start_minor, monthly_minor: f.monthly_minor, rate_pct: f.rate_pct, years: f.years }).at(-1)!.total_minor : null;
  const open = () => {
    const id = mutate((d) => {
      const first = d.get<{ s: number | null }>("SELECT MIN(sort) AS s FROM insights WHERE deleted=0")?.s ?? 0;
      return createInsight(d, { kind: "forecast", sort: first - 1 }).id;
    });
    router.push({ pathname: "/insights/[id]", params: { id } });
  };
  const close = () => mutate((d) => setMeta(d, PROMO_KEY, "dismissed"));
  return (
    <PressCard style={styles.promo} onPress={open} accessibilityLabel={t("future.promo.a11y")}>
      <View style={styles.cardRow}>
        {cat ? <Siriusia mood="seer" size={64} float /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.promoTitle}>{t("insights.kind.forecast.title")}</Text>
          <Text style={styles.line}>{end !== null ? t("future.promo.says", { count: f.years, amount: money(end, currency) }) : t("future.promo.generic")}</Text>
          <Text style={styles.promoGo}>{t("future.promo.open")}</Text>
        </View>
      </View>
      <Tap onPress={close} hitSlop={10} style={styles.promoClose} accessibilityRole="button" accessibilityLabel={t("future.promo.close")}>
        <SymbolView name="xmark" size={12} weight="semibold" tintColor={C.tertiary} />
      </Tap>
    </PressCard>
  );
}

/** Set once the promo's cross is tapped. Read by the Insights tab (which loads this file only to draw it). */
export const PROMO_KEY = "forecast_promo";

/* ── The details ──────────────────────────────────────────────────────────────────────────── */

type Tab = "you" | "grow" | "home" | "freedom" | "habit" | "inflation";
const TABS: Tab[] = ["you", "grow", "home", "freedom", "habit", "inflation"];

export function PurrphecyDetails({ insight }: { insight: Insight }) {
  const { pace, f: saved, set, rateFor, own } = useFuture(insight);
  const [tab, setTab] = useState<Tab>("you");
  // What a slider shows while it is being dragged, before it is let go and written.
  const [live, setLive] = useState<Partial<FutureInputs>>({});
  const f: Inputs = { ...saved, ...live } as Inputs;
  const change = useCallback((patch: Partial<FutureInputs>) => setLive((l) => ({ ...l, ...patch })), []);
  const commit = useCallback((patch: Partial<FutureInputs>) => {
    set(patch);
    setLive((l) => { const n = { ...l }; for (const k of Object.keys(patch)) delete n[k as keyof FutureInputs]; return n; });
  }, [set]);
  const io: IO = { f, pace, change, commit, rateFor, own };
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((x) => <Chip key={x} label={t(`future.tab.${x}`)} active={tab === x} onPress={() => setTab(x)} />)}
      </ScrollView>
      {tab === "you" ? <You {...io} /> : null}
      {tab === "grow" ? <Grow {...io} /> : null}
      {tab === "home" ? <Home {...io} /> : null}
      {tab === "freedom" ? <Freedom {...io} /> : null}
      {tab === "habit" ? <Habit {...io} /> : null}
      {tab === "inflation" ? <Inflation {...io} /> : null}
      <Text style={styles.hint}>{t("future.disclaimer")}</Text>
    </>
  );
}

/**
 * The one Siriusia on the screen, answering the tab's question in a sentence. Every tab opens with
 * it and none draws her again: the same picture twice on one screen reads as a template.
 */
function Hero({ mood, children }: { mood: SiriusiaMood; children: string }) {
  return <View style={{ marginTop: S.md }}><SiriusiaSays mood={mood} float>{children}</SiriusiaSays></View>;
}

interface IO {
  f: Inputs; pace: Pace; rateFor: Rate; own: FutureInputs;
  change: (p: Partial<FutureInputs>) => void; commit: (p: Partial<FutureInputs>) => void;
}

/* ── You ── */

function You({ f, pace, change, commit, own }: IO) {
  const [real, setReal] = useState(false);
  const cur = f.currency;
  const start = f.start_minor, monthly = f.monthly_minor;
  const paths = threePaths(f, start, monthly, real);
  const last = paths.market.length - 1;
  const more = Math.max(roundNice(monthly * 0.1), 100);
  const plus = growth({ start_minor: start, monthly_minor: monthly + more, rate_pct: f.rate_pct, years: f.years });
  const late = growth({ start_minor: start, monthly_minor: monthly, rate_pct: f.rate_pct, years: Math.max(0, f.years - 1) });
  const market = growth({ start_minor: start, monthly_minor: monthly, rate_pct: f.rate_pct, years: f.years });
  const targets = niceTargets(start);
  const deposit = themeHue("#FF9F0A");
  const end = paths.market[last]!, grew = end - paths.mattress[last]!;
  const hero: [SiriusiaMood, string] = !known(pace) && !start && !monthly ? ["sleep", t("future.card.noData")]
    : !monthly && (pace?.net_minor ?? 0) < 0 ? ["behind", t("future.you.negative")]
    : [grew > paths.put ? "wow" : "seer", t("future.you.says", { count: f.years, amount: money(end, cur), grew: money(grew, cur) })];
  return (
    <>
      <Hero mood={hero[0]}>{hero[1]}</Hero>
      <Setup f={f} pace={pace} own={own} commit={commit} />
      <SectionHeader>{t("future.you.paths", { count: f.years })}</SectionHeader>
      <Card>
        <LineChart currency={cur} height={120}
          series={[
            { key: "m", color: C.secondary, values: paths.mattress, dashed: true, width: 2 },
            { key: "d", color: deposit, values: paths.deposit },
            { key: "x", color: C.tint, values: paths.market, fill: true, width: 3 },
          ]}
          describe={(i) => t("future.you.at", { year: i, market: money(paths.market[i]!, cur), deposit: money(paths.deposit[i]!, cur), mattress: money(paths.mattress[i]!, cur) })}
          startLabel={t("future.now")} endLabel={t("future.yearsCount", { count: f.years })}
          legend={<Legend items={[{ color: C.tint, label: t("future.path.market", { rate: pct(f.rate_pct) }) }, { color: deposit, label: t("future.path.deposit", { rate: pct(f.deposit_pct) }) }, { color: C.secondary, label: t("future.path.mattress"), dashed: true }]} />} />
        <Row title={t("future.path.market", { rate: pct(f.rate_pct) })} right={<Amount minor={paths.market[last]!} currency={cur} color={C.tint} />} style={styles.divider} />
        <Row title={t("future.path.deposit", { rate: pct(f.deposit_pct) })} right={<Amount minor={paths.deposit[last]!} currency={cur} />} style={styles.divider} />
        <Row title={t("future.path.mattress")} subtitle={t("future.you.putInSub")} right={<Amount minor={paths.mattress[last]!} currency={cur} />} style={styles.divider} />
        <SliderRow label={t("future.yearsLabel")} value={f.years} min={1} max={40} step={1} format={(v) => t("future.yearsCount", { count: v })} onChange={(v) => change({ years: v })} onCommit={(v) => commit({ years: v })} />
        <SliderRow label={t("future.rate.market")} value={f.rate_pct} min={0} max={12} step={0.5} format={pct} onChange={(v) => change({ rate_pct: v })} onCommit={(v) => commit({ rate_pct: v })} />
        <SliderRow label={t("future.rate.deposit")} value={f.deposit_pct} min={0} max={10} step={0.25} format={pct} onChange={(v) => change({ deposit_pct: v })} onCommit={(v) => commit({ deposit_pct: v })} />
        <ToggleRow title={t("future.real.title")} subtitle={t("future.real.subtitle", { rate: pct(f.inflation_pct) })} value={real} onChange={setReal} style={styles.divider} />
      </Card>
      {monthly > 0 ? (
        <>
          <SectionHeader>{t("future.nudge.title")}</SectionHeader>
          <Card>
            <Row icon="plus.circle" iconColor="#34C759" title={t("future.nudge.more", { amount: money(more, cur) })} subtitle={t("future.nudge.moreSub", { count: f.years })}
              right={<Amount minor={plus[plus.length - 1]!.total_minor - market[market.length - 1]!.total_minor} currency={cur} color={C.green} sign />} />
            <Row icon="hourglass" iconColor="#FF3B30" title={t("future.nudge.late")} subtitle={t("future.nudge.lateSub")}
              right={<Amount minor={late[late.length - 1]!.total_minor - market[market.length - 1]!.total_minor} currency={cur} color={C.red} sign />} style={styles.divider} />
          </Card>
          <SectionHeader>{t("future.milestones")}</SectionHeader>
          <Card>
            {targets.map((target, i) => {
              const m = monthsToTarget({ have_minor: start, monthly_minor: monthly, rate_pct: f.rate_pct, target_minor: target });
              return <Row key={target} icon="flag.checkered" iconColor="#30B0C7" title={money(target, cur)}
                subtitle={m === null ? t("future.never") : t("future.inMonths", { when: monthPill(monthAfter(todayLocal(), m)), span: span(m) })} style={i ? styles.divider : undefined} />;
            })}
          </Card>
        </>
      ) : null}
    </>
  );
}

/**
 * What the forecast starts from, in one place: which accounts, in which currency, what is there and
 * what goes in a month. Each value says where it came from — read from your money, or set by you —
 * and one tap puts your own numbers back.
 */
function Setup({ f, pace, own, commit }: Pick<IO, "f" | "pace" | "own" | "commit">) {
  const cur = f.currency;
  const keys = useMemo(() => ({ acc: newPickKey("faccounts"), cur: newPickKey("fcurrency") }), []);
  usePickResult<string[]>(keys.acc, useCallback((ids: string[]) => commit({ account_ids: ids.length ? ids : undefined }), [commit]));
  usePickResult<string>(keys.cur, useCallback((c: string) => commit({ currency: c, start_minor: undefined, monthly_minor: undefined, home_price_minor: undefined, mortgage_extra_minor: undefined }), [commit]));
  const accounts = useQuery((d) => {
    const ids = f.account_ids;
    if (!ids.length) return null;
    const rows = ids.map((id) => getRow(d, "accounts", id)).filter((a) => a && !a.deleted);
    return rows.length === 1 ? acctName(rows[0]!) : t("future.setup.accountsSome", { count: rows.length });
  }, [f.account_ids.join(",")]);
  const mine = own.start_minor !== undefined || own.monthly_minor !== undefined;
  return (
    <>
      <SectionHeader>{t("future.setup.title")}</SectionHeader>
      <Card>
        <Row icon="creditcard" iconColor="#5856D6" title={t("future.setup.accounts")} right={<Text style={styles.value}>{accounts ?? t("future.setup.accountsAll")}</Text>}
          onPress={() => router.push({ pathname: "/pick/accounts", params: { key: keys.acc, selected: f.account_ids.join(",") } })} />
        <Row icon="coloncurrencysign.circle" iconColor="#34C759" title={t("future.setup.currency")} subtitle={pace?.missing.length ? t("future.setup.missing", { list: pace.missing.join(", ") }) : undefined} subtitleColor={C.orange}
          right={<Text style={styles.value}>{cur}</Text>} style={styles.divider}
          onPress={() => router.push({ pathname: "/pick/currency", params: { key: keys.cur, selected: cur, title: t("future.setup.currency") } })} />
        <AmountRow icon="banknote" iconColor="#30B0C7" title={t("future.setup.have")} minor={f.start_minor} currency={cur} divider
          subtitle={own.start_minor !== undefined ? t("future.setup.yours") : t("future.setup.haveSub")} onPick={(v) => commit({ start_minor: v })} />
        <AmountRow icon="arrow.down.circle" iconColor="#FF9F0A" title={t("future.setup.monthly")} minor={f.monthly_minor} currency={cur} divider
          subtitle={own.monthly_minor !== undefined ? t("future.setup.yours")
            : known(pace) && pace.periods ? t("future.setup.pace", { income: money(pace.income_minor, cur), spend: money(pace.spend_minor, cur), count: pace.periods }) : undefined}
          onPick={(v) => commit({ monthly_minor: v })} />
        {mine ? <Row title={t("future.grow.mine")} titleNode={<Text style={styles.link}>{t("future.grow.mine")}</Text>} onPress={() => commit({ start_minor: undefined, monthly_minor: undefined })} style={styles.divider} /> : null}
      </Card>
    </>
  );
}

/** The next three round sums above what you have: 10 000, 25 000, 50 000 … */
function niceTargets(have: number): number[] {
  const steps = [1, 2.5, 5];
  const out: number[] = [];
  for (let p = 100_000; out.length < 3 && p < 1e14; p *= 10) {
    for (const s of steps) { const v = s * p; if (v > have && out.length < 3) out.push(v); }
  }
  return out;
}

/** "2 years 3 months", "8 months". */
function span(months: number): string {
  const y = Math.floor(months / 12), m = months % 12;
  if (!y) return t("future.span.months", { count: m });
  if (!m) return t("future.span.years", { count: y });
  return t("future.span.both", { years: t("future.span.years", { count: y }), months: t("future.span.months", { count: m }) });
}

/* ── Compound interest ── */

function Grow({ f, own, change, commit }: IO) {
  const cur = f.currency;
  const g = growth({ start_minor: f.start_minor, monthly_minor: f.monthly_minor, rate_pct: f.rate_pct, years: f.years, inflation_pct: f.inflation_pct, raise_pct: f.raise_pct });
  const end = g[g.length - 1]!;
  const cross = crossoverYear(g);
  const dbl = doublingYears(f.rate_pct);
  const custom = own.start_minor !== undefined || own.monthly_minor !== undefined;
  const grew = themeHue("#34C759");
  return (
    <>
      <Hero mood={end.growth_minor > end.contributed_minor ? "wow" : "seer"}>
        {t("future.grow.says", { count: f.years, total: money(end.total_minor, cur), grew: money(end.growth_minor, cur) })}
      </Hero>
      <SectionHeader>{t("future.grow.inputs")}</SectionHeader>
      <Card>
        <AmountRow title={t("future.grow.start")} minor={f.start_minor} currency={cur} onPick={(v) => commit({ start_minor: v })} />
        <AmountRow title={t("future.grow.monthly")} minor={f.monthly_minor} currency={cur} onPick={(v) => commit({ monthly_minor: v })} divider />
        {custom ? <Row title={t("future.grow.mine")} titleNode={<Text style={styles.link}>{t("future.grow.mine")}</Text>} onPress={() => commit({ start_minor: undefined, monthly_minor: undefined })} style={styles.divider} /> : null}
        <SliderRow label={t("future.rate.market")} value={f.rate_pct} min={0} max={15} step={0.5} format={pct} onChange={(v) => change({ rate_pct: v })} onCommit={(v) => commit({ rate_pct: v })} />
        <SliderRow label={t("future.yearsLabel")} value={f.years} min={1} max={50} step={1} format={(v) => t("future.yearsCount", { count: v })} onChange={(v) => change({ years: v })} onCommit={(v) => commit({ years: v })} />
        <SliderRow label={t("future.grow.raise")} value={f.raise_pct} min={0} max={10} step={0.5} format={pct} onChange={(v) => change({ raise_pct: v })} onCommit={(v) => commit({ raise_pct: v })} />
      </Card>
      <SectionHeader>{t("future.grow.result", { count: f.years })}</SectionHeader>
      <Card>
        <StackChart currency={cur} height={120} stacks={g.map((y) => [y.contributed_minor, y.growth_minor])} colors={[C.tint, grew]}
          describe={(i) => t("future.grow.at", { year: g[i]!.year, total: money(g[i]!.total_minor, cur), put: money(g[i]!.contributed_minor, cur), grew: money(g[i]!.growth_minor, cur) })}
          startLabel={t("future.now")} endLabel={t("future.yearsCount", { count: f.years })}
          legend={<Legend items={[{ color: C.tint, label: t("future.grow.youPut") }, { color: grew, label: t("future.grow.itGrew") }]} />} />
        <Row title={t("future.grow.total")} right={<Amount minor={end.total_minor} currency={cur} big />} style={styles.divider} />
        <Row title={t("future.grow.youPut")} right={<Amount minor={end.contributed_minor} currency={cur} />} style={styles.divider} />
        <Row title={t("future.grow.itGrew")} right={<Amount minor={end.growth_minor} currency={cur} color={C.green} />} style={styles.divider} />
        <Row title={t("future.grow.real", { rate: pct(f.inflation_pct) })} right={<Amount minor={end.real_minor} currency={cur} color={C.secondary} />} style={styles.divider} />
      </Card>
      <View style={{ marginTop: S.md }}>
        <Card>
          {dbl ? <Row icon="multiply.circle" iconColor="#AF52DE" title={t("future.grow.doubles", { years: decimal(Math.round(dbl * 10) / 10) })} subtitle={t("future.grow.doublesSub")} /> : null}
          <Row icon="arrow.up.forward.circle" iconColor="#34C759" title={cross ? t("future.grow.cross", { year: cross }) : t("future.grow.noCross")} subtitle={t("future.grow.crossSub")} style={dbl ? styles.divider : undefined} />
        </Card>
      </View>
    </>
  );
}

/* ── A home ── */

function Home({ f, pace, change, commit }: IO) {
  const cur = f.currency;
  const down = Math.round((f.home_price_minor * f.down_pct) / 100);
  const toDown = monthsToTarget({ have_minor: f.start_minor, monthly_minor: f.monthly_minor, rate_pct: f.deposit_pct, target_minor: down });
  const loan = mortgage({ principal_minor: f.home_price_minor - down, rate_pct: f.mortgage_rate_pct, years: f.mortgage_years });
  const extra = f.mortgage_extra_minor ? mortgage({ principal_minor: f.home_price_minor - down, rate_pct: f.mortgage_rate_pct, years: f.mortgage_years, extra_minor: f.mortgage_extra_minor }) : null;
  const share = pace?.income_minor ? loan.monthly_minor / pace.income_minor : null;
  const mood: SiriusiaMood = toDown === null ? "behind" : toDown <= 36 ? "happy" : "seer";
  const owed = loan.balance_by_year;
  const owedFast = extra ? owed.map((_, i) => extra.balance_by_year[i] ?? 0) : null;
  return (
    <>
      <Hero mood={mood}>{toDown === 0 ? t("future.home.ready") : toDown === null ? t("future.home.never") : t("future.home.when", { when: monthPill(monthAfter(todayLocal(), toDown)), span: span(toDown) })}</Hero>
      <SectionHeader>{t("future.home.inputs")}</SectionHeader>
      <Card>
        <AmountRow title={t("future.home.price")} minor={f.home_price_minor} currency={cur} onPick={(v) => commit({ home_price_minor: v })} />
        <AmountRow title={t("future.home.saved")} minor={f.start_minor} currency={cur} onPick={(v) => commit({ start_minor: v })} divider />
        <AmountRow title={t("future.home.monthly")} minor={f.monthly_minor} currency={cur} onPick={(v) => commit({ monthly_minor: v })} divider />
        <SliderRow label={t("future.home.down")} value={f.down_pct} min={0} max={50} step={5} format={pct} onChange={(v) => change({ down_pct: v })} onCommit={(v) => commit({ down_pct: v })} />
      </Card>
      <SectionHeader>{t("future.home.downTitle", { amount: money(down, cur) })}</SectionHeader>
      <Card style={{ paddingHorizontal: S.lg, paddingVertical: S.md, gap: 6 }}>
        <ProgressBar ratio={down > 0 ? Math.min(1, f.start_minor / down) : 1} color={C.green} height={10} />
        <Text style={styles.sub}>{t("future.home.progress", { have: money(f.start_minor, cur), down: money(down, cur), pct: down > 0 ? Math.min(100, Math.round((f.start_minor / down) * 100)) : 100 })}</Text>
      </Card>
      <SectionHeader>{t("future.home.loanTitle", { amount: money(loan.principal_minor, cur) })}</SectionHeader>
      <Card>
        <SliderRow label={t("future.home.rate")} value={f.mortgage_rate_pct} min={0} max={15} step={0.25} format={pct} onChange={(v) => change({ mortgage_rate_pct: v })} onCommit={(v) => commit({ mortgage_rate_pct: v })} first />
        <SliderRow label={t("future.home.years")} value={f.mortgage_years} min={5} max={35} step={1} format={(v) => t("future.yearsCount", { count: v })} onChange={(v) => change({ mortgage_years: v })} onCommit={(v) => commit({ mortgage_years: v })} />
        <Row title={t("future.home.instalment")} subtitle={share !== null ? t("future.home.share", { pct: Math.round(share * 100) }) : undefined} subtitleColor={share !== null && share > 0.35 ? C.orange : undefined}
          right={<Amount minor={loan.monthly_minor} currency={cur} big />} style={styles.divider} />
        <Row title={t("future.home.interest")} subtitle={loan.principal_minor ? t("future.home.interestSub", { pct: Math.round((loan.interest_minor / loan.principal_minor) * 100) }) : undefined} right={<Amount minor={loan.interest_minor} currency={cur} color={C.red} />} style={styles.divider} />
        <Row title={t("future.home.total")} right={<Amount minor={loan.total_minor + down} currency={cur} />} style={styles.divider} />
        {loan.principal_minor > 0 ? (
          <LineChart currency={cur} height={100}
            series={[{ key: "o", color: C.red, values: owed, fill: true }, ...(owedFast ? [{ key: "f", color: C.green, values: owedFast, dashed: true }] : [])]}
            describe={(i) => owedFast ? t("future.home.owedFast", { year: i, owed: money(owed[i]!, cur), fast: money(owedFast[i]!, cur) }) : t("future.home.owed", { year: i, owed: money(owed[i]!, cur) })}
            startLabel={t("future.now")} endLabel={t("future.yearsCount", { count: f.mortgage_years })}
            legend={owedFast ? <Legend items={[{ color: C.red, label: t("future.home.owedLegend") }, { color: C.green, label: t("future.home.fastLegend"), dashed: true }]} /> : undefined} />
        ) : null}
      </Card>
      <SectionHeader>{t("future.home.overpay")}</SectionHeader>
      <Card>
        <AmountRow title={t("future.home.extra")} minor={f.mortgage_extra_minor} currency={cur} onPick={(v) => commit({ mortgage_extra_minor: v })} />
        {extra ? (
          <>
            <Row icon="bolt" iconColor="#34C759" title={t("future.home.sooner", { span: span(Math.max(0, loan.months - extra.months)) })} style={styles.divider} />
            <Row icon="banknote" iconColor="#34C759" title={t("future.home.saves")} right={<Amount minor={loan.interest_minor - extra.interest_minor} currency={cur} color={C.green} />} style={styles.divider} />
          </>
        ) : <Text style={[styles.hint, { paddingVertical: S.sm }]}>{t("future.home.extraHint")}</Text>}
      </Card>
    </>
  );
}

/* ── Freedom ── */

function Freedom({ f, pace, change, commit }: IO) {
  if (!pace || !pace.spend_minor) return <Hero mood="sleep">{t("future.freedom.noData")}</Hero>;
  const cur = f.currency;
  const yearly = pace.spend_minor * 12;
  const number = freedomNumber(yearly, f.withdraw_pct);
  const have = f.start_minor;
  const monthly = f.monthly_minor;
  const months = monthsToTarget({ have_minor: have, monthly_minor: monthly, rate_pct: f.rate_pct, target_minor: number });
  const more = Math.max(roundNice(pace.spend_minor * 0.1), 100);
  const sooner = monthsToTarget({ have_minor: have, monthly_minor: monthly + more, rate_pct: f.rate_pct, target_minor: number });
  // Spending a tenth less moves both ends: the pot needed shrinks, and what is saved grows.
  const lean = freedomNumber(yearly * 0.9, f.withdraw_pct);
  const leanMonths = monthsToTarget({ have_minor: have, monthly_minor: monthly + Math.round(pace.spend_minor * 0.1), rate_pct: f.rate_pct, target_minor: lean });
  const horizon = Math.min(60, Math.max(10, months !== null ? Math.ceil(months / 12) + 2 : 40));
  const path = growth({ start_minor: have, monthly_minor: monthly, rate_pct: f.rate_pct, years: horizon });
  const ratio = number ? Math.min(1, have / number) : 0;
  const gain = (a: number | null, b: number | null) => (a !== null && b !== null && a > b ? span(a - b) : null);
  return (
    <>
      <Hero mood={months === null ? "behind" : "wow"}>{months === null ? t("future.freedom.never") : t("future.freedom.when", { year: monthAfter(todayLocal(), months).slice(0, 4), span: span(months) })}</Hero>
      <SectionHeader>{t("future.freedom.number")}</SectionHeader>
      <Card>
        <Row title={t("future.freedom.yearly")} subtitle={t("future.freedom.yearlySub")} right={<Amount minor={yearly} currency={cur} />} />
        <Row title={t("future.freedom.pot", { rate: pct(f.withdraw_pct) })} right={<Amount minor={number} currency={cur} big />} style={styles.divider} />
        <View style={[styles.divider, { paddingHorizontal: S.lg, paddingVertical: S.md, gap: 6 }]}>
          <ProgressBar ratio={ratio} color={C.green} height={10} />
          <Text style={styles.sub}>{t("future.freedom.progress", { pct: Math.round(ratio * 1000) / 10, have: money(have, cur) })}</Text>
        </View>
        <SliderRow label={t("future.freedom.withdraw")} value={f.withdraw_pct} min={2.5} max={6} step={0.25} format={pct} onChange={(v) => change({ withdraw_pct: v })} onCommit={(v) => commit({ withdraw_pct: v })} />
        <SliderRow label={t("future.rate.market")} value={f.rate_pct} min={0} max={12} step={0.5} format={pct} onChange={(v) => change({ rate_pct: v })} onCommit={(v) => commit({ rate_pct: v })} />
      </Card>
      <SectionHeader>{t("future.freedom.road")}</SectionHeader>
      <Card>
        <LineChart currency={cur} height={110} series={[{ key: "p", color: C.green, values: path.map((y) => y.total_minor), fill: true, width: 3 }]}
          target={{ minor: number, color: C.tint, label: t("future.freedom.line") }}
          describe={(i) => t("future.freedom.at", { year: i, total: money(path[i]!.total_minor, cur), pct: number ? Math.round((path[i]!.total_minor / number) * 100) : 0 })}
          startLabel={t("future.now")} endLabel={t("future.yearsCount", { count: horizon })} />
      </Card>
      <SectionHeader>{t("future.nudge.title")}</SectionHeader>
      <Card>
        <Row icon="plus.circle" iconColor="#34C759" title={t("future.freedom.saveMore", { amount: money(more, cur) })} subtitle={gain(months, sooner) ? t("future.freedom.sooner", { span: gain(months, sooner)! }) : t("future.freedom.noChange")} />
        <Row icon="scissors" iconColor="#FF9F0A" title={t("future.freedom.spendLess")} subtitle={gain(months, leanMonths) ? t("future.freedom.leanSooner", { span: gain(months, leanMonths)!, amount: money(number - lean, cur) }) : t("future.freedom.noChange")} style={styles.divider} />
      </Card>
      <Text style={[styles.hint, { marginTop: S.sm }]}>{t("future.freedom.explain", { rate: pct(f.withdraw_pct), times: Math.round(100 / f.withdraw_pct) })}</Text>
    </>
  );
}

/* ── Small habits ── */

function Habit({ f, change, commit, rateFor }: IO) {
  const cur = f.currency;
  const startDay = useQuery(() => getPeriodStartDay());
  const key = useMemo(() => newPickKey("fhabit"), []);
  usePickResult<string | null>(key, useCallback((id: string | null) => { if (id) commit({ habit_category_id: id }); }, [commit]));
  // What could go, first: categories marked "could stop tomorrow" (DATA.md rule 15), then the
  // biggest spending of the last half year. Folders are left out — a habit is one thing.
  // Read in every currency, converted below: a coffee is a coffee whichever card paid for it.
  const raw = useQuery((d) => {
    const cats = listRows(d, "categories", "deleted=0 AND archived=0") as Category[];
    const parents = new Set(cats.map((c) => c.parent_id).filter(Boolean));
    const level = categoryImportance(cats);
    // Six complete periods, every category at once: one query a period, not one per category.
    const windows = periodWindows(todayLocal(), startDay, 7).filter((w) => !w.current);
    const spent: { id: string; currency: string; minor: number }[] = [];
    for (const w of windows) for (const x of categorySpend(d, w.start, w.end)) if (x.category_id) spent.push({ id: x.category_id, currency: x.currency, minor: -x.spent_minor });
    return { cats: cats.filter((c) => !parents.has(c.id)), low: new Set(cats.filter((c) => level.get(c.id) === 1).map((c) => c.id)), spent, periods: Math.max(1, windows.length) };
  }, [startDay]);
  const inCur = (minor: number, from: string) => { const r = rateFor(from, cur); return r === null ? 0 : convertMinor(minor, from, cur, r); };
  const sum = new Map<string, number>();
  for (const x of raw.spent) sum.set(x.id, (sum.get(x.id) ?? 0) + inCur(x.minor, x.currency));
  const average = (id: string) => Math.round((sum.get(id) ?? 0) / raw.periods);
  const ideas = raw.cats.map((c) => ({ c, minor: average(c.id), low: raw.low.has(c.id) }))
    .filter((x) => x.minor > 0).sort((a, b) => Number(b.low) - Number(a.low) || b.minor - a.minor).slice(0, 6);
  const chosenId = f.habit_category_id ?? ideas[0]?.c.id ?? null;
  const cat = useQuery((d) => (chosenId ? (getRow(d, "categories", chosenId) as Category | undefined) ?? null : null), [chosenId]);
  const chosen = cat ? { c: cat, minor: average(cat.id) } : null;
  const cut = chosen ? Math.round((chosen.minor * f.habit_cut_pct) / 100) : 0;
  const g = growth({ start_minor: 0, monthly_minor: cut, rate_pct: f.rate_pct, years: 30 });
  const grew = themeHue("#34C759");
  return (
    <>
      <Hero mood={chosen && cut > 0 ? "wow" : "sleep"}>{chosen && cut > 0 ? t("future.habit.says", { category: catName(chosen.c), amount: money(g[20]!.total_minor, cur) }) : t("future.habit.none")}</Hero>
      <SectionHeader>{t("future.habit.which")}</SectionHeader>
      <View style={styles.chips}>
        {ideas.map((x) => <Chip key={x.c.id} label={catName(x.c)} active={x.c.id === chosenId} onPress={() => commit({ habit_category_id: x.c.id })} />)}
        <Chip label={t("future.habit.other")} icon="ellipsis" onPress={() => router.push({ pathname: "/pick/category", params: { key, selected: chosenId ?? "" } })} />
      </View>
      {!chosen ? null : (
        <>
          <Card style={{ marginTop: S.md }}>
            <Row title={t("future.habit.average", { category: catName(chosen.c) })} subtitle={t("future.habit.averageSub")} right={<Amount minor={chosen.minor} currency={cur} />} />
            <SliderRow label={t("future.habit.cut")} value={f.habit_cut_pct} min={10} max={100} step={10} format={pct} onChange={(v) => change({ habit_cut_pct: v })} onCommit={(v) => commit({ habit_cut_pct: v })} />
            <Row title={t("future.habit.freed")} right={<Amount minor={cut} currency={cur} color={C.green} />} style={styles.divider} />
          </Card>
          {cut > 0 ? (
            <>
              <SectionHeader>{t("future.habit.invested", { rate: pct(f.rate_pct) })}</SectionHeader>
              <Card>
                <StackChart currency={cur} height={110} stacks={g.map((y) => [y.contributed_minor, y.growth_minor])} colors={[C.tint, grew]}
                  describe={(i) => t("future.grow.at", { year: g[i]!.year, total: money(g[i]!.total_minor, cur), put: money(g[i]!.contributed_minor, cur), grew: money(g[i]!.growth_minor, cur) })}
                  startLabel={t("future.now")} endLabel={t("future.yearsCount", { count: 30 })}
                  legend={<Legend items={[{ color: C.tint, label: t("future.grow.youPut") }, { color: grew, label: t("future.grow.itGrew") }]} />} />
                {[5, 10, 20, 30].map((y) => <Row key={y} title={t("future.habit.inYears", { count: y })} right={<Amount minor={g[y]!.total_minor} currency={cur} />} style={styles.divider} />)}
              </Card>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

/* ── Inflation ── */

function Inflation({ f, change, commit }: IO) {
  const cur = f.currency;
  const amount = Math.max(f.start_minor, 100_000);
  const n = f.years;
  const cash = Array.from({ length: n + 1 }, (_, y) => realValue(amount, f.inflation_pct, y));
  const real = (rate: number) => Array.from({ length: n + 1 }, (_, y) => realValue(Math.round(amount * Math.pow(1 + rate / 100, y)), f.inflation_pct, y));
  const dep = real(f.deposit_pct), mkt = real(f.rate_pct);
  const deposit = themeHue("#FF9F0A");
  const keep = Math.round(amount * Math.pow(1 + f.inflation_pct / 100, n));
  return (
    <>
      <Hero mood={f.inflation_pct > f.deposit_pct ? "behind" : "seer"}>{t("future.inflation.says", { amount: money(amount, cur), count: n, real: money(cash[n]!, cur) })}</Hero>
      <SectionHeader>{t("future.inflation.title")}</SectionHeader>
      <Card>
        <SliderRow label={t("future.inflation.rate")} value={f.inflation_pct} min={0} max={15} step={0.5} format={pct} onChange={(v) => change({ inflation_pct: v })} onCommit={(v) => commit({ inflation_pct: v })} first />
        <SliderRow label={t("future.yearsLabel")} value={n} min={1} max={40} step={1} format={(v) => t("future.yearsCount", { count: v })} onChange={(v) => change({ years: v })} onCommit={(v) => commit({ years: v })} />
        <LineChart currency={cur} height={110}
          series={[{ key: "c", color: C.red, values: cash, dashed: true }, { key: "d", color: deposit, values: dep }, { key: "m", color: C.tint, values: mkt, fill: true }]}
          target={{ minor: amount, color: C.secondary, label: t("future.inflation.today") }}
          describe={(i) => t("future.inflation.at", { year: i, cash: money(cash[i]!, cur), deposit: money(dep[i]!, cur), market: money(mkt[i]!, cur) })}
          startLabel={t("future.now")} endLabel={t("future.yearsCount", { count: n })}
          legend={<Legend items={[{ color: C.tint, label: t("future.path.market", { rate: pct(f.rate_pct) }) }, { color: deposit, label: t("future.path.deposit", { rate: pct(f.deposit_pct) }) }, { color: C.red, label: t("future.path.mattress"), dashed: true }]} />} />
        <Row title={t("future.inflation.keep", { count: n })} subtitle={t("future.inflation.keepSub")} right={<Amount minor={keep} currency={cur} />} style={styles.divider} />
      </Card>
      <Text style={[styles.hint, { marginTop: S.sm }]}>{t("future.inflation.hint")}</Text>
    </>
  );
}

/* ── Pieces ── */

function Amount({ minor, currency, color, big, sign }: { minor: number; currency: string; color?: ColorValue; big?: boolean; sign?: boolean }) {
  const s = `${sign && minor > 0 ? "+" : minor < 0 ? "−" : ""}${whole(Math.abs(minor), currency)} ${currency}`;
  return <Text style={[styles.amount, big && styles.amountBig, color ? { color } : null]}>{s}</Text>;
}

/** A sum to set, on the app's own keypad. */
function AmountRow({ title, subtitle, icon, iconColor, minor, currency, onPick, divider }: {
  title: string; subtitle?: string; icon?: SFSymbol; iconColor?: string; minor: number; currency: string; onPick: (v: number) => void; divider?: boolean;
}) {
  const key = useMemo(() => newPickKey("famount"), []);
  usePickResult<number>(key, useCallback((v: number) => onPick(v), [onPick]));
  return <Row title={title} subtitle={subtitle} icon={icon} iconColor={iconColor} right={<Amount minor={minor} currency={currency} />} onPress={() => router.push({ pathname: "/pick/amount", params: { key, title, currency, value: String(minor || "") } })} style={divider ? styles.divider : undefined} />;
}

/**
 * A number on a native slider: the value redraws everything while the thumb moves (`onChange`), and
 * is written when it is let go (`onCommit`) — one write per decision, not one per pixel.
 */
function SliderRow({ label, value, min, max, step, format, onChange, onCommit, first }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string;
  onChange: (v: number) => void; onCommit: (v: number) => void; first?: boolean;
}) {
  const [v, setV] = useState(value);
  const latest = useRef(value);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only a value the thumb actually moved to is written: a touch that moved nothing writes nothing.
  const moved = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const shown = dragging ? v : value;
  const snap = (x: number) => Math.min(max, Math.max(min, Math.round(x / step) * step));
  const done = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (moved.current && latest.current !== value) onCommit(latest.current);
    moved.current = false;
  };
  return (
    <View style={[styles.slider, !first && styles.divider]}>
      <View style={styles.sliderTop}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{format(shown)}</Text>
      </View>
      <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
        <Slider value={shown} min={min} max={max} step={step}
          onValueChange={(x) => {
            const s = snap(x); latest.current = s; moved.current = true; setV(s); setDragging(true); onChange(s);
            // Written when the thumb is let go; and in case that is never reported, once it rests.
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => { done(); setDragging(false); }, 800);
          }}
          onEditingChanged={(editing) => { if (editing) setDragging(true); else { done(); setDragging(false); } }} />
      </Host>
    </View>
  );
}

const strong = { b: (s: ReactNode) => <Text style={{ fontWeight: "600", color: C.label }}>{s}</Text> };

const styles = themed(() => StyleSheet.create({
  cardRow: { flexDirection: "row", alignItems: "center", gap: S.md },
  sub: { fontSize: 13, color: C.secondary },
  big: { fontSize: 26, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  line: { fontSize: 13, color: C.secondary, marginTop: 2 },
  tabs: { gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: S.sm, paddingHorizontal: S.lg },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.secondary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.lg },
  link: { color: C.tint, fontSize: 16 },
  value: { fontSize: 16, color: C.secondary },
  promo: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 16, padding: S.lg },
  promoTitle: { fontSize: 17, fontWeight: "700", color: C.label },
  promoGo: { fontSize: 15, fontWeight: "600", color: C.tint, marginTop: 4 },
  promoClose: { position: "absolute", top: S.md, right: S.md, width: 24, height: 24, borderRadius: 12, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  amount: { fontSize: 16, fontWeight: "600", color: C.label, fontVariant: ["tabular-nums"] },
  amountBig: { fontSize: 18, fontWeight: "700" },
  slider: { paddingHorizontal: S.lg, paddingTop: 10, paddingBottom: 6 },
  sliderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  sliderLabel: { fontSize: 15, color: C.label, flex: 1 },
  sliderValue: { fontSize: 15, fontWeight: "600", color: C.tint, fontVariant: ["tabular-nums"] },
}));
