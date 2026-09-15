import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams, useNavigation, usePathname } from "expo-router";
import { SymbolView } from "expo-symbols";
import { dueManualRules, getRow, jsonIds, listRows, remove, save, sumInBase, type Transaction } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { TransactionList, sortByAmount, useTransactions } from "@/components/TransactionList";
import { BarButton, BottomBar, LogButton, useScrollHide } from "@/components/BottomBar";
import { PeriodPill } from "@/components/PeriodPill";
import { ScopePill } from "@/components/ScopePill";
import { Money, StatPair } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { EMPTY_FILTER, activeCount, buildWhere, rangeLabel, type TxFilter } from "@/lib/filters";
import { todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { getBudgetScope, getHideIncome, setBudgetScope } from "@/lib/settings";
import { scopeAccountIds, scopeLabel, scopeOptions } from "@/lib/scope";
import { markBooted } from "@/lib/boot";

type Params = { category?: string; tag?: string; name?: string; from?: string; to?: string; accounts?: string; nonce?: string };

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
  const fromParams = useCallback((): TxFilter => ({ ...EMPTY_FILTER, categories: p.category ? [p.category] : [], tags: p.tag ? [p.tag] : [], accounts: p.accounts ? p.accounts.split(",").filter(Boolean) : p.tag ? [] : scopeAccounts, from: p.from ?? null, to: p.to ?? null }), [p.category, p.tag, p.accounts, p.from, p.to, scopeAccounts]);
  const [filter, setFilter] = useState<TxFilter>(fromParams);
  useEffect(() => { setFilter((f) => ({ ...f, accounts: scopeAccounts })); }, [scopeAccounts.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState<"date" | "amount">("date");
  const [sortGen, setSortGen] = useState(0);
  useEffect(() => { if (p.nonce) { setFilter(fromParams()); setSort("date"); setSortGen((g) => g + 1); } }, [p.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const navigation = useNavigation();
  useEffect(() => {
    const tabs = navigation.getParent();
    if (!tabs) return;
    return (tabs as { addListener: (type: string, cb: () => void) => () => void }).addListener("tabPress", () => {
      if (navigation.isFocused()) return;   // re-tap of the current tab: iOS scrolls to the top, filters stay
      setFilter({ ...EMPTY_FILTER, accounts: scopeAccountIds(getBudgetScope(), listRows(db, "accounts", "deleted=0")) });
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
  const dueRecurring = useQuery((d) => {
    const due = dueManualRules(d, todayLocal());
    const accounts = new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a]));
    let total = 0;
    for (const { rule, days } of due) if (accounts.get(rule.account_id)?.currency === base) total += rule.amount_minor * days.length;
    return { n: due.length, total };
  }, [base]);
  const pending = useQuery((d) => d.get<{ n: number; total: number | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN a.currency=? THEN t.amount_minor ELSE 0 END) AS total
     FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.deleted=0 AND t.pending=1`, [base]), [base]);
  // Income and expenses, per currency first. Money held in another currency used to be dropped from
  // both numbers outright — a salary paid in dollars added up to nothing, and scoping to the account
  // holding it showed a month with no income at all.
  const perCurrency = useMemo(() => {
    const inc = new Map<string, number>(), exp = new Map<string, number>();
    for (const t of rows) {
      if (t.transfer_id) continue;   // a transfer moves your own money: neither earned nor spent
      const side = t.amount_minor > 0 ? inc : exp;
      side.set(t.currency, (side.get(t.currency) ?? 0) + t.amount_minor);
    }
    const list = (m: Map<string, number>) => [...m].map(([currency, minor]) => ({ currency, minor }));
    return { inc: list(inc), exp: list(exp), currencies: [...new Set([...inc.keys(), ...exp.keys()])] };
  }, [rows]);
  const { rateFor, loading: fetchingRates } = useRates(perCurrency.currencies, base);
  // One currency on screen — the usual case, and what scoping to a single foreign account gives —
  // is shown exactly, in that currency. Only a genuinely mixed list is converted, and then it says so.
  // At today's rate, like Net worth and Budgets: there is no rate row for most past days, and the
  // question these two numbers answer is what the month comes to now, not on each day it happened.
  const only = perCurrency.currencies.length <= 1 ? perCurrency.currencies[0] ?? base : null;
  const totals = only
    ? { inc: perCurrency.inc[0]?.minor ?? 0, exp: perCurrency.exp[0]?.minor ?? 0, currency: only, approx: false, missing: [] as string[] }
    : (() => {
        const i = sumInBase(perCurrency.inc, base, rateFor), e = sumInBase(perCurrency.exp, base, rateFor);
        return { inc: i.minor, exp: e.minor, currency: base, approx: true, missing: [...new Set([...i.missing, ...e.missing])] };
      })();
  const toggleSort = () => { setSort((s) => (s === "date" ? "amount" : "date")); setSortGen((g) => g + 1); };
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
      <TransactionList rows={sorted} flat={sort === "amount"} resetKey={`sort-${sortGen}`} onScroll={onScroll} selected={selected ?? undefined} onToggle={toggleRow} header={
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
            ...(hideIncome ? [] : [{ label: "Income", minor: totals.inc, currency: totals.currency, color: C.green, approx: totals.approx }]),
            { label: "Expenses", minor: totals.exp, currency: totals.currency, color: C.red, approx: totals.approx },
          ]} />
          {/* Same words as Net worth uses, for the same reason: a total quietly missing a currency is worse than one that admits it. */}
          {totals.missing.length ? (
            <Text style={styles.ratesWarn}>{fetchingRates ? `Fetching ${totals.missing.join(", ")} rate…` : `No rate yet for ${totals.missing.join(", ")}, so it is left out. Connect to the internet once.`}</Text>
          ) : null}
          {dueRecurring.n > 0 ? (
            <Pressable onPress={() => router.push("/recurring/due")} accessibilityRole="button" accessibilityLabel={`${dueRecurring.n} recurring payments due, review them`}
              style={({ pressed }) => [styles.due, pressed && { opacity: 0.7 }]}>
              <SymbolView name="repeat.circle.fill" size={20} tintColor={C.red} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pendingTitle}>{dueRecurring.n === 1 ? "1 recurring payment due" : `${dueRecurring.n} recurring payments due`}</Text>
                <Text style={styles.pendingSub}>Tap to post or skip</Text>
              </View>
              {dueRecurring.total ? <Money minor={dueRecurring.total} currency={base} style={styles.dueSum} /> : null}
              <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
            </Pressable>
          ) : null}
          {pending && pending.n > 0 ? (
            <Pressable onPress={() => router.push("/pending")} accessibilityRole="button" accessibilityLabel={`${pending.n} pending, review them`}
              style={({ pressed }) => [styles.pending, pressed && { opacity: 0.7 }]}>
              <SymbolView name="clock.badge.exclamationmark" size={20} tintColor={C.orange} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pendingTitle}>{pending.n === 1 ? "1 pending entry" : `${pending.n} pending entries`}</Text>
                <Text style={styles.pendingSub}>Tap to check and approve</Text>
              </View>
              {pending.total ? <Money minor={pending.total} currency={base} style={styles.pendingSum} /> : null}
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
            <BarButton icon="line.3.horizontal.decrease" label={n ? String(n) : undefined} active={n > 0} onPress={() => router.push({ pathname: "/filter", params: { key: keys.filter, value: JSON.stringify(filter) } })} a11y={n ? `Filters, ${n} active` : "Filters"} />
            <BarButton icon={sort === "date" ? "arrow.up.arrow.down" : "arrow.down.to.line"} active={sort === "amount"} onPress={toggleSort} a11y={sort === "date" ? "Sort by amount" : "Sort by date"} />
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
