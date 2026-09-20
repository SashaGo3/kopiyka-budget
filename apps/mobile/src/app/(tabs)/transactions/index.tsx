import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams, useNavigation, usePathname } from "expo-router";
import { SymbolView } from "expo-symbols";
import { dueManualRules, formatMinor, getRow, jsonIds, listRows, oneCurrency, remove, save, trimNumber, type Transaction } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { TransactionList, sortByAmount, useTransactions } from "@/components/TransactionList";
import { BarButton, BottomBar, LogButton, useScrollHide } from "@/components/BottomBar";
import { PeriodPill } from "@/components/PeriodPill";
import { ScopePill } from "@/components/ScopePill";
import { Empty, Money, StatPair } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { EMPTY_FILTER, activeCount, buildWhere, rangeLabel, type TxFilter, type TxType } from "@/lib/filters";
import { todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { getBudgetScope, getHideIncome, setBudgetScope } from "@/lib/settings";
import { scopeAccountIds, scopeLabel, scopeOptions } from "@/lib/scope";
import { markBooted } from "@/lib/boot";
import { isPad } from "@/constants/layout";

/** Two presses of the tab within this are one gesture, not two taps. */
const DOUBLE_PRESS_MS = 400;

/** A currency → total map as the list `oneCurrency` takes. */
const perList = (m: Map<string, number>) => [...m].map(([currency, minor]) => ({ currency, minor }));

type Params = { category?: string; tag?: string; name?: string; from?: string; to?: string; accounts?: string; type?: TxType; nonce?: string };

/**
 * Sorting and filtering live in the bottom bar (thumb zone); active filters are pinned
 * above it. Arriving from Budgets (params carry a nonce) applies that category filter;
 * pressing the tab in the tab bar returns to the defaults: the account scope and nothing else
 * (a Budgets category would otherwise stick forever). Neither the period nor the scope is one of
 * them — both are the shared selections Budgets shows too, and both have a pill here.
 * The same screen backs the search tab, where the search field is focused on arrival.
 * "Select" in the header switches to multi-edit: pick some or all rows, then set their
 * category, add / remove tags, move them to another day, confirm pending ones or delete
 * them from the bottom bar. The header keeps its large title while selecting: toggling it
 * forces a native relayout of the whole screen and made leaving selection mode stutter.
 */
export default function TransactionsScreen() {
  const p = useLocalSearchParams<Params>();
  const isSearchTab = usePathname().startsWith("/search");
  const [period, setPeriod] = usePeriod();   // the same month Budgets is showing
  useEffect(() => { markBooted(); }, []); // the landing tab's first content frame: the root layout drops its shimmer skeleton
  // The account scope is the same one Budgets shows, switched from the pill here as well.
  const scope = useQuery(() => getBudgetScope());
  const scopeAccounts = useQuery((db) => scopeAccountIds(scope, listRows(db, "accounts", "deleted=0")), [scope]);
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  const fromParams = useCallback((): TxFilter => ({ ...EMPTY_FILTER, categories: p.category ? [p.category] : [], tags: p.tag ? [p.tag] : [], accounts: p.accounts ? p.accounts.split(",").filter(Boolean) : p.tag ? [] : scopeAccounts, type: p.type ?? null, from: p.from ?? null, to: p.to ?? null }), [p.category, p.tag, p.accounts, p.type, p.from, p.to, scopeAccounts]);
  const [filter, setFilter] = useState<TxFilter>(fromParams);
  useEffect(() => { setFilter((f) => ({ ...f, accounts: scopeAccounts })); }, [scopeAccounts.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState<"date" | "amount">("date");
  const [sortGen, setSortGen] = useState(0);
  useEffect(() => { if (p.nonce) { setFilter(fromParams()); setSort("date"); setSortGen((g) => g + 1); } }, [p.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const navigation = useNavigation();
  const lastTabPress = useRef(0);
  // What the tab-press handler needs to read without being re-subscribed on every keystroke.
  const shown = useRef({ filter, period });
  shown.current = { filter, period };
  useEffect(() => {
    const tabs = navigation.getParent();
    if (!tabs) return;
    /** The accounts the screen shows when nothing is filtered: whatever the scope pill says. */
    const scoped = () => scopeAccountIds(getBudgetScope(), listRows(db, "accounts", "deleted=0"));
    return (tabs as { addListener: (type: string, cb: () => void) => () => void }).addListener("tabPress", () => {
      if (navigation.isFocused()) {
        // Re-tap of the tab already on screen: iOS scrolls to the top, and a single press means
        // nothing else. A second one straight after it clears the filters — the quickest way back
        // to the whole month from wherever Budgets or a category editor sent you. The period and
        // the account scope are deliberately left alone: both are shared with Budgets, and both
        // have a pill of their own right there. The search text stays too, because on the search
        // tab the field is the truth and clearing one without the other leaves them disagreeing.
        const now = Date.now();
        const twice = now - lastTabPress.current < DOUBLE_PRESS_MS;
        lastTabPress.current = twice ? 0 : now;
        if (!twice) return;
        const inScope = scoped();
        const { filter: f, period: per } = shown.current;
        if (!activeCount(f, { accounts: inScope, period: per })) return;   // nothing to clear: no jolt, no haptic
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setFilter({ ...EMPTY_FILTER, q: f.q, accounts: inScope });
        setSort("date"); setSortGen((g) => g + 1);
        return;
      }
      setFilter({ ...EMPTY_FILTER, accounts: scoped() });
      setSort("date"); setSortGen((g) => g + 1);   // the period is shared with Budgets: whatever month is open stays open
    });
  }, [navigation]);
  const keys = useMemo(() => ({ filter: newPickKey("filter"), month: newPickKey("month"), scope: newPickKey("scope"), cat: newPickKey("mcat"), tags: newPickKey("mtags"), date: newPickKey("mdate") }), []);
  usePickResult<TxFilter>(keys.filter, useCallback((f: TxFilter) => setFilter(f), []));
  usePickResult<string>(keys.scope, useCallback((v: string) => setBudgetScope(v === "all" ? "" : v), []));
  usePickResult<string>(keys.month, useCallback((d: string) => setPeriod(periodContaining(`${d.slice(0, 8)}${String(Math.min(getPeriodStartDay(), 28)).padStart(2, "0")}`)), []));
  const { visible, onScroll } = useScrollHide();

  const custom = !!(filter.from || filter.to) || !!filter.upcoming;
  const { where, params } = buildWhere(filter, filter.from || filter.to ? null : period);
  // "Hide income" is a display preference, not a filter — but asking for income explicitly still wins,
  // so picking Income in the filter sheet never lands on a list that is empty by design.
  const hideIncome = useQuery(() => getHideIncome()) && filter.type !== "income";
  const rows = useTransactions(hideIncome ? `(${where}) AND NOT (t.transfer_id IS NULL AND t.amount_minor>0)` : where, params, 2000);
  const sorted = sort === "amount" ? sortByAmount(rows) : rows;
  const n = activeCount(filter, { accounts: scopeAccounts, period });
  const base = useQuery(() => getBaseCurrency());
  // Deliberately outside the filter and the period: a Shortcut automation can write a pending entry
  // into any month, and an entry nobody ever approves is exactly the one that must stay visible.
  // Manual recurring payments whose day has passed. Like Pending, deliberately outside the filter
  // and the period: a payment you still owe is not something a month view should hide.
  // Every figure on this screen is summed per currency and only then reduced to one (`oneCurrency`):
  // a count and an amount that disagree are worse than either on its own, and money held in another
  // currency used to be dropped from all three of them without a word.
  const dueRecurring = useQuery((d) => {
    const due = dueManualRules(d, todayLocal());
    const accounts = new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a]));
    const per = new Map<string, number>();
    for (const { rule, days } of due) {
      const currency = accounts.get(rule.account_id)?.currency;
      if (currency) per.set(currency, (per.get(currency) ?? 0) + rule.amount_minor * days.length);
    }
    return { n: due.length, per: perList(per) };
  }, []);
  const pending = useQuery((d) => {
    const groups = d.all<{ currency: string; minor: number; n: number }>(
      `SELECT a.currency AS currency, SUM(t.amount_minor) AS minor, COUNT(*) AS n
       FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.deleted=0 AND t.pending=1 GROUP BY a.currency`);
    return { n: groups.reduce((a, g) => a + g.n, 0), per: groups.map((g) => ({ currency: g.currency, minor: g.minor })) };
  }, []);
  const perCurrency = useMemo(() => {
    const inc = new Map<string, number>(), exp = new Map<string, number>();
    for (const t of rows) {
      if (t.transfer_id) continue;   // a transfer moves your own money: neither earned nor spent
      const side = t.amount_minor > 0 ? inc : exp;
      side.set(t.currency, (side.get(t.currency) ?? 0) + t.amount_minor);
    }
    return { inc: perList(inc), exp: perList(exp) };
  }, [rows]);
  // Pending and the recurring dues are deliberately outside the filter and the period, so their
  // currencies are asked for here too rather than taken from the rows on screen.
  const currencies = useMemo(() => [...new Set([...perCurrency.inc, ...perCurrency.exp, ...pending.per, ...dueRecurring.per].map((x) => x.currency))],
    [perCurrency, pending, dueRecurring]);
  const { rateFor, loading: fetchingRates } = useRates(currencies, base);
  // Converted at today's rate, like Net worth and Budgets: there is no rate row for most past days,
  // and what these numbers answer is what the month comes to now, not on each day it happened.
  const totals = oneCurrency([perCurrency.inc, perCurrency.exp], base, rateFor);
  const pendingSum = oneCurrency([pending.per], base, rateFor);
  const dueSum = oneCurrency([dueRecurring.per], base, rateFor);
  const missingRates = [...new Set([...totals.missing, ...pendingSum.missing, ...dueSum.missing])];
  /**
   * A stat, and — when its number had to be converted — a way to find out why. The "≈" otherwise has
   * to be taken on trust, which is the one thing an approximate number cannot ask for: tapping names
   * the money that was converted and the rate it went at, and offers the rows themselves.
   */
  const statOf = (t: { minor: number; approx: boolean; converted: { currency: string; minor: number }[] }, label: string, kind: "income" | "expense") => ({
    minor: t.minor, currency: totals.currency, approx: t.approx,
    onPress: t.approx ? () => {
      const lines = t.converted.map((c) => {
        const rate = rateFor(c.currency, totals.currency);
        return `${formatMinor(Math.abs(c.minor), c.currency)} ${c.currency}${rate ? ` at ${trimNumber(rate)}` : " — no rate yet"}`;
      });
      const ids = accounts.filter((a) => t.converted.some((c) => c.currency === a.currency)).map((a) => a.id);
      Alert.alert(`${label} is approximate`,
        `${lines.join("\n")}\n\nConverted into ${totals.currency} at today's rate. Everything else in this ${label.toLowerCase()} total was already in ${totals.currency}.`, [
          { text: "OK", style: "cancel" },
          ...(ids.length ? [{ text: "Show them", onPress: () => router.push({ pathname: "/transactions", params: { accounts: ids.join(","), type: kind, ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}), nonce: String(Date.now()) } }) }] : []),
        ]);
    } : undefined,
  });
  const toggleSort = () => { setSort((s) => (s === "date" ? "amount" : "date")); setSortGen((g) => g + 1); };
  /**
   * An empty list that says why it is empty. Every reason is something the screen is doing —
   * the account scope, the month, the filter sheet — and each of them is a pill or a badge the
   * eye slides straight past. A device that has just merged another one's data is the case that
   * made this necessary: it is scoped to the one account it was set up with, every transaction
   * that arrived belongs to the others, and "No transactions" was the only thing it said.
   */
  const narrowing = [
    scope ? `from ${scopeLabel(scope, accounts)}` : null,
    custom ? rangeLabel(filter.from, filter.to).toLowerCase() : `in ${period.subtitle ?? period.title}`,
    n ? `with ${n} filter${n === 1 ? "" : "s"} on` : null,
  ].filter(Boolean);
  const showEverything = () => {
    setBudgetScope("");
    setFilter({ ...EMPTY_FILTER });
    setPeriod(currentPeriod());
    setSort("date"); setSortGen((g) => g + 1);
  };
  const emptyList = (
    <Empty title="No transactions"
      hint={`Nothing ${narrowing.join(", ")}.`}
      action={{ label: "Show everything", onPress: showEverything }} />
  );
  const pickScope = () => router.push({ pathname: "/pick/option", params: { key: keys.scope, title: "Spending from", options: JSON.stringify(scopeOptions(accounts)), selected: scope || "all" } });

  // Multi-edit. `selected` is null outside selection mode.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selecting = selected !== null;
  const chosen = useMemo(() => (selected ? rows.filter((t) => selected.has(t.id)) : []), [rows, selected]);
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toggleRow = useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(rows.map((t) => t.id)));
  /** Apply a change to every chosen row; both legs of a chosen transfer change together. */
  const editChosen = (fn: (t: Transaction) => Partial<Transaction>) => {
    mutate((d) => {
      for (const id of chosenIds(d)) { const t = getRow(d, "transactions", id); if (t) save(d, "transactions", { ...t, ...fn(t) }); }
    });
    setSelected(null);
  };
  const chosenIds = (d: Parameters<Parameters<typeof mutate>[0]>[0]) => {
    const ids = new Set(chosen.map((t) => t.id));
    for (const t of chosen) if (t.transfer_id) for (const leg of listRows(d, "transactions", "deleted=0 AND transfer_id=?", [t.transfer_id])) ids.add(leg.id);
    return ids;
  };
  // Move every chosen row to another day; each keeps its own time of day.
  const pickDate = () => {
    if (!chosen.length) return;
    const same = chosen.every((t) => t.date.slice(0, 10) === chosen[0]!.date.slice(0, 10)) ? chosen[0]!.date.slice(0, 10) : todayLocal();
    router.push({ pathname: "/pick/date", params: { key: keys.date, selected: same } });
  };
  usePickResult<string>(keys.date, useCallback((day: string) => editChosen((t) => ({ date: day + t.date.slice(10) })), [chosen])); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteChosen = () => {
    if (!chosen.length) return;
    const transfers = chosen.filter((t) => t.transfer_id).length;
    Alert.alert(chosen.length === 1 ? "Delete this transaction?" : `Delete ${chosen.length} transactions?`, transfers ? "Both sides of a transfer are deleted together." : undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { mutate((d) => { for (const id of chosenIds(d)) remove(d, "transactions", id); }); setSelected(null); } },
    ]);
  };
  const pickCategory = () => {
    if (!chosen.length) return;
    const kind = chosen.every((t) => !t.transfer_id && t.amount_minor > 0) ? "income" : "expense";
    // Same category everywhere: preselect it. Mixed: nothing is ticked ("-" matches no row and is not empty).
    const same = chosen.every((t) => t.category_id === chosen[0]!.category_id) ? chosen[0]!.category_id ?? "" : "-";
    router.push({ pathname: "/pick/category", params: { key: keys.cat, kind, selected: same } });
  };
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => editChosen(() => ({ category_id: v })), [chosen])); // eslint-disable-line react-hooks/exhaustive-deps
  // Tags: the picker starts with the tags every chosen row already has. Ticking adds a tag to
  // all of them, unticking one of the shared tags removes it from all; other tags are untouched.
  const shared = useMemo(() => chosen.length ? chosen.map((t) => jsonIds(t.tag_ids)).reduce((acc, ids) => acc.filter((id) => ids.includes(id))) : [], [chosen]);
  const pickTags = () => {
    if (!chosen.length) return;
    const cat = chosen.every((t) => t.category_id === chosen[0]!.category_id) ? chosen[0]!.category_id ?? "" : "";
    router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: shared.join(","), category: cat } });
  };
  usePickResult<string[]>(keys.tags, useCallback((picked: string[]) => {
    const add = picked.filter((id) => !shared.includes(id)), drop = shared.filter((id) => !picked.includes(id));
    if (!add.length && !drop.length) { setSelected(null); return; }
    editChosen((t) => { const ids = jsonIds(t.tag_ids).filter((id) => !drop.includes(id)); return { tag_ids: JSON.stringify([...ids, ...add.filter((id) => !ids.includes(id))]) }; });
  }, [chosen, shared])); // eslint-disable-line react-hooks/exhaustive-deps
  const headerButton = (label: string, onPress: () => void, bold = false) => (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}><Text style={[styles.headerLink, bold && { fontWeight: "700" }]} maxFontSizeMultiplier={1.3}>{label}</Text></Pressable>
  );
  const range = filter.from || filter.to ? rangeLabel(filter.from, filter.to) : filter.upcoming ? "Upcoming" : "";
  // What the screen was opened *about* — a category from Budgets, a tag or a category from its
  // editor — kept in the title beside the range. Dropped as soon as that filter is gone, so the
  // header never names something the list is no longer showing.
  const named = p.name && ((p.category && filter.categories.includes(p.category)) || (p.tag && filter.tags.includes(p.tag))) ? p.name : "";
  const customTitle = [named, range].filter(Boolean).join(" · ");

  return (
    <>
      <Stack.Screen options={{ title: selecting ? `${chosen.length} selected` : custom ? customTitle : isSearchTab ? "Search" : "Transactions", headerLargeTitle: !custom,
        headerLeft: selecting ? () => headerButton(allChosen ? "Deselect all" : "Select all", toggleAll) : undefined,
        headerRight: rows.length || selecting ? () => headerButton(selecting ? "Done" : "Select", () => setSelected(selecting ? null : new Set()), selecting) : undefined,
        // Search lives in the search tab only (iOS puts its field in the bottom tab bar).
        headerSearchBarOptions: isSearchTab ? { placeholder: "Search notes, categories, amounts", hideWhenScrolling: false, autoFocus: true,
          onChangeText: (e) => { const text = e?.nativeEvent?.text ?? ""; setFilter((f) => (f.q === text ? f : { ...f, q: text })); },
          onCancelButtonPress: () => setFilter((f) => (f.q ? { ...f, q: "" } : f)) } : undefined }} />
      <TransactionList rows={sorted} flat={sort === "amount"} resetKey={`sort-${sortGen}`} onScroll={onScroll} selected={selected ?? undefined} onToggle={toggleRow} empty={emptyList} header={
        <>
          {/* Same place as on Budgets: under the large title, so they scroll away with it instead of crowding the compact bar. */}
          {!custom && !selecting ? (
            <View style={styles.pills}>
              <PeriodPill period={period} onPrev={() => setPeriod(shiftPeriod(period, -1))} onNext={() => setPeriod(shiftPeriod(period, 1))} onReset={() => setPeriod(currentPeriod())}
                onPick={() => router.push({ pathname: "/pick/month", params: { key: keys.month, selected: period.start } })} />
              <ScopePill label={scopeLabel(scope, accounts)} active={!!scope} onPress={pickScope} />
            </View>
          ) : null}
          {/* Totals next — the month at a glance. Then what still needs a decision: recurring you owe, then entries to check. */}
          <StatPair stats={[
            ...(hideIncome ? [] : [{ label: "Income", ...statOf(totals.totals[0]!, "Income", "income"), color: C.green }]),
            { label: "Expenses", ...statOf(totals.totals[1]!, "Expenses", "expense"), color: C.red },
          ]} />
          {/* Same words as Net worth uses, for the same reason: a total quietly missing a currency is worse than one that admits it. */}
          {missingRates.length ? (
            <Text style={styles.ratesWarn}>{fetchingRates ? `Fetching ${missingRates.join(", ")} rate…` : `No rate yet for ${missingRates.join(", ")}, so it is left out. Connect to the internet once.`}</Text>
          ) : null}
          {dueRecurring.n > 0 ? (
            <Pressable onPress={() => router.push("/recurring/due")} accessibilityRole="button" accessibilityLabel={`${dueRecurring.n} recurring payments due, review them`}
              style={({ pressed }) => [styles.due, pressed && { opacity: 0.7 }]}>
              <SymbolView name="repeat.circle.fill" size={20} tintColor={C.red} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pendingTitle}>{dueRecurring.n === 1 ? "1 recurring payment due" : `${dueRecurring.n} recurring payments due`}</Text>
                <Text style={styles.pendingSub}>Tap to post or skip</Text>
              </View>
              {dueSum.totals[0]!.minor ? <Money minor={dueSum.totals[0]!.minor} currency={dueSum.currency} approx={dueSum.totals[0]!.approx} style={styles.dueSum} /> : null}
              <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
            </Pressable>
          ) : null}
          {pending.n > 0 ? (
            <Pressable onPress={() => router.push("/pending")} accessibilityRole="button" accessibilityLabel={`${pending.n} pending, review them`}
              style={({ pressed }) => [styles.pending, pressed && { opacity: 0.7 }]}>
              <SymbolView name="clock.badge.exclamationmark" size={20} tintColor={C.orange} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pendingTitle}>{pending.n === 1 ? "1 pending entry" : `${pending.n} pending entries`}</Text>
                <Text style={styles.pendingSub}>Tap to check and approve</Text>
              </View>
              {pendingSum.totals[0]!.minor ? <Money minor={pendingSum.totals[0]!.minor} currency={pendingSum.currency} approx={pendingSum.totals[0]!.approx} style={styles.pendingSum} /> : null}
              <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
            </Pressable>
          ) : null}
        </>
      } />
      <BottomBar visible={visible || selecting}>
        {selecting ? (
          <>
            <BarButton icon="folder" label="Category" active={chosen.length > 0} onPress={pickCategory} a11y={`Set category of ${chosen.length} selected`} />
            <BarButton icon="number" active={chosen.length > 0} onPress={pickTags} a11y={`Edit tags of ${chosen.length} selected`} />
            <BarButton icon="calendar" active={chosen.length > 0} onPress={pickDate} a11y={`Change date of ${chosen.length} selected`} />
            {chosen.some((t) => t.pending) ? <BarButton icon="checkmark.circle" label="Confirm" active onPress={() => editChosen(() => ({ pending: 0 }))} a11y={`Confirm ${chosen.filter((t) => t.pending).length} pending`} /> : null}
            <BarButton icon="trash" color={C.red} onPress={deleteChosen} a11y={`Delete ${chosen.length} selected`} />
          </>
        ) : (
          <>
            {/* In the iPad column there is room for the words, and a column of icons alone is a
                puzzle; on a phone the bar is in the thumb zone and the count is all that fits. */}
            <BarButton icon="line.3.horizontal.decrease" label={isPad ? (n ? `Filters · ${n}` : "Filter") : n ? String(n) : undefined}
              active={n > 0} onPress={() => router.push({ pathname: "/filter", params: { key: keys.filter, value: JSON.stringify(filter) } })} a11y={n ? `Filters, ${n} active` : "Filters"} />
            <BarButton icon={sort === "date" ? "arrow.up.arrow.down" : "arrow.down.to.line"} label={isPad ? (sort === "date" ? "By date" : "By amount") : undefined}
              active={sort === "amount"} onPress={toggleSort} a11y={sort === "date" ? "Sort by amount" : "Sort by date"} />
            <LogButton />
          </>
        )}
      </BottomBar>
    </>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.xs },
  pending: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, paddingHorizontal: S.md, paddingVertical: 10, borderRadius: R.card, backgroundColor: "rgba(255,149,0,0.14)" },
  due: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, paddingHorizontal: S.md, paddingVertical: 10, borderRadius: R.card, backgroundColor: "rgba(255,59,48,0.14)" },
  dueSum: { fontSize: 16, fontWeight: "700", color: C.red },
  pendingTitle: { fontSize: 16, fontWeight: "600", color: C.label },
  pendingSub: { fontSize: 13, color: C.secondary },
  pendingSum: { fontSize: 16, fontWeight: "700", color: C.orange },
  headerLink: { color: C.tint, fontSize: 17 },
  ratesWarn: { color: C.orange, fontSize: 12, paddingHorizontal: S.xl, paddingBottom: S.xs },
});
