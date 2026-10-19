import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams, useNavigation } from "expo-router";
import { SymbolView } from "expo-symbols";
import { dueManualRules, formatMinor, getRow, waitingRules, jsonIds, listRows, listTrips, numberFormat, oneCurrency, remove, trimNumber, withTransferLegs, type BulkChange } from "@kopiyka/core";
import type { SearchBarCommands } from "react-native-screens";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { TransactionList, sortByAmount, useTransactions } from "@/components/TransactionList";
import { BarButton, BottomBar, LogButton, useScrollHide } from "@/components/BottomBar";
import { PeriodPill } from "@/components/PeriodPill";
import { TripCard } from "@/components/TripCard";
import { ScopePill } from "@/components/ScopePill";
import { ButtonText, Empty, Money, StatPair } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { ALL_TIME, EMPTY_FILTER, activeCount, buildWhere, rangeLabel, type TxFilter, type TxType } from "@/lib/filters";
import { todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { getBudgetScope, getHideIncome, setBudgetScope, waitDefaultDays } from "@/lib/settings";
import { scopeAccountIds, scopeLabel, scopeOptions } from "@/lib/scope";
import { markBooted } from "@/lib/boot";
import { DISMISS_MS } from "@/lib/nav";
import { isPad } from "@/constants/layout";
import { t } from "@/i18n";
import { catNameById } from "@/lib/names";
import { useSearchIds } from "@/lib/search";

/** Two presses of the tab within this are one gesture, not two taps. */
const DOUBLE_PRESS_MS = 400;

const NO_ACCOUNTS: string[] = [];

/** A currency → total map as the list `oneCurrency` takes. */
const perList = (m: Map<string, number>) => [...m].map(([currency, minor]) => ({ currency, minor }));

type Params = { category?: string; tag?: string; name?: string; from?: string; to?: string; accounts?: string; type?: TxType; nonce?: string };

/**
 * Sorting and filtering live in the bottom bar (thumb zone); active filters are pinned
 * above it. Arriving from Budgets (params carry a nonce) applies that category filter;
 * pressing the tab in the tab bar returns to the defaults: the account scope and nothing else
 * (a Budgets category would otherwise stick forever). Neither the period nor the scope is one of
 * them — both are the shared selections Budgets shows too, and both have a pill here.
 * The same screen backs Search, pushed from the magnifying glass in this header, where the search
 * field is focused on arrival. Search looks through every month and every account: it has neither
 * pill, only the filter sheet narrows it. Its filter and sort are in the header, where the keyboard
 * cannot cover them.
 * Touching and holding a row switches to multi-edit: pick some or all rows, then set their category,
 * add / remove tags, move them to another day, write a note over them all, confirm pending ones or
 * delete them from the bottom bar. Everything but delete goes through `/transaction/bulk` first,
 * which shows what each row would become and is the only thing that writes. The header keeps its
 * large title while selecting: toggling it forces a native relayout of the whole screen and made
 * leaving selection mode stutter.
 */
export default function TransactionsTab() {
  return <TransactionsScreen isSearch={false} />;
}

/**
 * `isSearch` is which copy this is (app/search.tsx mounts the other one, on the root stack), fixed for its life.
 * It used to be read off the current path, which both copies see: while Search was open the
 * Transactions copy behind it took the search title and header field too.
 */
export function TransactionsScreen({ isSearch }: { isSearch: boolean }) {
  const p = useLocalSearchParams<Params>();
  const [period, setPeriod] = usePeriod();   // the same month Budgets is showing
  useEffect(() => { markBooted(); }, []); // the landing tab's first content frame: the native launch screen fades off it (lib/boot.ts)
  // The account scope is the same one Budgets shows, switched from the pill here as well.
  const scope = useQuery(() => getBudgetScope());
  const scopeAccounts = useQuery((db) => scopeAccountIds(scope, listRows(db, "accounts", "deleted=0")), [scope]);
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  // Search has no scope pill: it looks through every account, and the filter sheet is what narrows it.
  const inScope = isSearch ? NO_ACCOUNTS : scopeAccounts;
  const fromParams = useCallback((): TxFilter => ({ ...EMPTY_FILTER, categories: p.category ? [p.category] : [], tags: p.tag ? [p.tag] : [], accounts: p.accounts ? p.accounts.split(",").filter(Boolean) : p.tag ? [] : inScope, type: p.type ?? null, from: p.from ?? null, to: p.to ?? null }), [p.category, p.tag, p.accounts, p.type, p.from, p.to, inScope]);
  const [filter, setFilter] = useState<TxFilter>(fromParams);
  useEffect(() => { setFilter((f) => ({ ...f, accounts: inScope })); }, [inScope.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState<"date" | "amount">("date");
  const [sortGen, setSortGen] = useState(0);
  useEffect(() => { if (p.nonce) { setFilter(fromParams()); setSort("date"); setSortGen((g) => g + 1); } }, [p.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const navigation = useNavigation();
  const lastTabPress = useRef(0);
  // What the tab-press handler needs to read without being re-subscribed on every keystroke — and
  // written in an effect, not during render, because the React Compiler is on.
  const shown = useRef({ filter, period });
  useEffect(() => { shown.current = { filter, period }; }, [filter, period]);
  /** Everything back to the defaults: no filters, no account scope, this month, by date. */
  const showEverything = useCallback(() => {
    setBudgetScope("");
    setFilter({ ...EMPTY_FILTER });
    setPeriod(currentPeriod());
    setSort("date"); setSortGen((g) => g + 1);
  }, [setPeriod]);
  /** The filter sheet's answers only: the search text, the month and the account scope stay. */
  const clearFilters = useCallback((inScope: string[]) => {
    setFilter((f) => ({ ...EMPTY_FILTER, q: f.q, accounts: inScope }));
    setSort("date"); setSortGen((g) => g + 1);
  }, []);
  /**
   * Clearing the screen asks first, and says what it is about to clear.
   *
   * Three things narrow this list and only one of them is the filter sheet — the account scope and
   * the month are shared with Budgets and have pills of their own — so "reset" is two different
   * answers and the alert offers whichever apply. It used to just happen, silently, on a gesture
   * nobody could see: a double tap that threw away a filter set up a minute ago and said nothing
   * about it. Returns false when there is nothing on, so a caller can stay quiet rather than
   * buzzing and opening an alert about nothing.
   *
   * Read through `shown` rather than the render's own values: the tab listener below is subscribed
   * once and would otherwise be asking about the screen as it was when the tab was first opened.
   */
  const askReset = useCallback(() => {
    const inScope = isSearch ? NO_ACCOUNTS : scopeAccountIds(getBudgetScope(), listRows(db, "accounts", "deleted=0"));
    const { filter: f, period: per } = shown.current;
    const count = activeCount(f, { accounts: inScope, period: isSearch ? null : per });
    // Search has no month or scope to reset: it looks through all of them.
    const scoped = !isSearch && !!getBudgetScope(), month = !isSearch && per.start !== currentPeriod().start;
    if (!count && !scoped && !month) return false;
    const on = [count ? t("transactions.reset.filters", { count }) : "", scoped ? t("transactions.reset.scope") : "", month ? (per.subtitle ?? per.title) : ""].filter(Boolean);
    Alert.alert(t("transactions.reset.title"), t("transactions.reset.body", { what: on.join(", ") }), [
      { text: t("common.cancel"), style: "cancel" },
      ...(count ? [{ text: t("transactions.reset.clear", { count }), onPress: () => clearFilters(inScope) }] : []),
      ...(scoped || month ? [{ text: t("transactions.reset.defaults"), onPress: showEverything }] : []),
    ]);
    return true;
  }, [clearFilters, showEverything, isSearch]);
  useEffect(() => {
    const tabs = navigation.getParent();
    if (!tabs || isSearch) return;   // the root copy answers for the tab; a press while Search is open pops back to it
    /** The accounts the screen shows when nothing is filtered: whatever the scope pill says. */
    const scoped = () => scopeAccountIds(getBudgetScope(), listRows(db, "accounts", "deleted=0"));
    const tabNav = tabs as unknown as { addListener: (type: string, cb: () => void) => () => void; getState: () => { index: number; routes: { name: string }[] } };
    return tabNav.addListener("tabPress", () => {
      // Pressed while Search is pushed over the list: iOS pops back to it, and that is all it means.
      const st = tabNav.getState();
      if (st.routes[st.index]?.name === "transactions" && !navigation.isFocused()) return;
      if (navigation.isFocused()) {
        // Re-tap of the tab already on screen: iOS scrolls to the top, and a single press means
        // nothing else. A second one straight after it offers the way back to the whole month from
        // wherever Budgets or a category editor sent you — the same question the Filter button
        // asks when it is held, because a native tab bar reports nothing but a press and a hidden
        // gesture cannot be the only way to reach something.
        const now = Date.now();
        const twice = now - lastTabPress.current < DOUBLE_PRESS_MS;
        lastTabPress.current = twice ? 0 : now;
        if (!twice) return;
        if (askReset()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);   // nothing on: no jolt, no alert
        return;
      }
      setFilter({ ...EMPTY_FILTER, accounts: scoped() });
      setSort("date"); setSortGen((g) => g + 1);   // the period is shared with Budgets: whatever month is open stays open
    });
  }, [navigation, askReset, isSearch]);
  const keys = useMemo(() => ({ filter: newPickKey("filter"), month: newPickKey("month"), scope: newPickKey("scope"), cat: newPickKey("mcat"), tags: newPickKey("mtags"), date: newPickKey("mdate"), note: newPickKey("mnote"), bulk: newPickKey("mbulk") }), []);
  usePickResult<TxFilter>(keys.filter, useCallback((f: TxFilter) => setFilter(f), []));
  usePickResult<string>(keys.scope, useCallback((v: string) => setBudgetScope(v === "all" ? "" : v), []));
  usePickResult<string>(keys.month, useCallback((d: string) => setPeriod(periodContaining(`${d.slice(0, 8)}${String(Math.min(getPeriodStartDay(), 28)).padStart(2, "0")}`)), []));
  const { visible, onScroll } = useScrollHide();

  const trips = useQuery((d) => listTrips(d));
  // A travel is out of the month's boundaries — the flights were bought weeks before, the trip may
  // straddle two months — so a list filtered to one has no period at all, and its card, not the
  // month's Income/Expenses, is what sums it up.
  const tripTag = filter.tags.length === 1 && trips.some((t) => t.tag_id === filter.tags[0]) ? filter.tags[0]! : null;
  const custom = !!(filter.from || filter.to) || !!filter.upcoming || !!tripTag;
  /** The month that narrows the list: none on Search, which looks through all of them, or once a range or a trip is picked. */
  const listPeriod = isSearch || filter.from || filter.to || tripTag ? null : period;
  // Search finds by everything a row has — tags, trip, debt, folder, shown names — typos forgiven (lib/search.ts).
  const searchIds = useSearchIds(filter.q);
  const { where, params } = buildWhere(filter, listPeriod, undefined, searchIds);
  // "Hide income" is a display preference, not a filter — but asking for income explicitly still wins,
  // so picking Income in the filter sheet never lands on a list that is empty by design.
  const hideIncome = useQuery(() => getHideIncome()) && filter.type !== "income";
  const rows = useTransactions(hideIncome ? `(${where}) AND NOT (t.transfer_id IS NULL AND t.amount_minor>0)` : where, params, 2000);
  const sorted = sort === "amount" ? sortByAmount(rows) : rows;
  const n = activeCount(filter, { accounts: inScope, period: isSearch ? null : period });
  // The travel budget at the top: the trip whose tag the list is filtered on (from its card, from
  // Budgets, or the filter sheet's Travel row), else the one running now while the list is unfiltered
  // by tag — it is what the entries being logged count against, which is the reason to be here.
  const shownTrip = filter.tags.length === 1 ? trips.find((t) => t.tag_id === filter.tags[0]) ?? null
    : !filter.tags.length && !isSearch ? trips.find((t) => !t.ended) ?? null : null;
  const base = useQuery(() => getBaseCurrency());
  // Deliberately outside the filter and the period: a Shortcut automation can write a pending entry
  // into any month, and an entry nobody ever approves is exactly the one that must stay visible.
  // Manual recurring payments whose day has passed. Like Pending, deliberately outside the filter
  // and the period: a payment you still owe is not something a month view should hide.
  // Every figure on this screen is summed per currency and only then reduced to one (`oneCurrency`):
  // a count and an amount that disagree are worse than either on its own, and money held in another
  // currency used to be dropped from all three of them without a word.
  const dueRecurring = useQuery((d) => {
    const today = todayLocal(), waitDefault = waitDefaultDays();
    const due = dueManualRules(d, today, waitDefault);
    const accounts = new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a]));
    const per = new Map<string, number>();
    for (const { rule, days } of due) {
      const currency = accounts.get(rule.account_id)?.currency;
      if (currency) per.set(currency, (per.get(currency) ?? 0) + rule.amount_minor * days.length);
    }
    // Rules whose day has come while they wait for the bank owe nothing yet, so they are counted
    // apart from the dues and never added to the sum: nothing has left the account, and a number
    // that says otherwise is the whole problem this feature exists to stop.
    return { n: due.length, per: perList(per), waiting: waitingRules(d, today, waitDefault).length };
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
  const statOf = (s: { minor: number; approx: boolean; converted: { currency: string; minor: number }[] }, kind: "income" | "expense") => ({
    minor: s.minor, currency: totals.currency, approx: s.approx,
    onPress: s.approx ? () => {
      const lines = s.converted.map((c) => {
        const rate = rateFor(c.currency, totals.currency);
        const amount = formatMinor(Math.abs(c.minor), c.currency);
        return rate ? t("transactions.approx.at", { amount, currency: c.currency, rate: trimNumber(rate).replace(".", numberFormat().decimal) }) : t("transactions.approx.noRate", { amount, currency: c.currency });
      });
      const ids = accounts.filter((a) => s.converted.some((c) => c.currency === a.currency)).map((a) => a.id);
      const income = kind === "income";
      Alert.alert(income ? t("transactions.approx.incomeTitle") : t("transactions.approx.expensesTitle"),
        income ? t("transactions.approx.incomeBody", { lines: lines.join("\n"), currency: totals.currency }) : t("transactions.approx.expensesBody", { lines: lines.join("\n"), currency: totals.currency }), [
          { text: t("common.ok"), style: "cancel" },
          ...(ids.length ? [{ text: t("transactions.approx.show"), onPress: () => router.push({ pathname: "/transactions", params: { accounts: ids.join(","), type: kind, ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}), nonce: String(Date.now()) } }) }] : []),
        ]);
    } : undefined,
  });
  const dueTitle = dueRecurring.n === 0 ? t("transactions.due.expected", { count: dueRecurring.waiting }) : t("transactions.due.due", { count: dueRecurring.n });
  const dueSub = dueRecurring.n === 0 ? t("transactions.due.waiting")
    : dueRecurring.waiting ? t("transactions.due.tapMore", { count: dueRecurring.waiting }) : t("transactions.due.tap");
  const openFilter = () => router.push({ pathname: "/filter", params: { key: keys.filter, value: JSON.stringify(filter) } });
  const toggleSort = () => { setSort((s) => (s === "date" ? "amount" : "date")); setSortGen((g) => g + 1); };
  /**
   * An empty list that says why it is empty. Every reason is something the screen is doing —
   * the account scope, the month, the filter sheet — and each of them is a pill or a badge the
   * eye slides straight past. A device that has just merged another one's data is the case that
   * made this necessary: it is scoped to the one account it was set up with, every transaction
   * that arrived belongs to the others, and "No transactions" was the only thing it said.
   */
  const narrowing = [
    scope && !isSearch ? t("transactions.empty.scope", { scope: scopeLabel(scope, accounts) }) : null,
    custom ? rangeLabel(filter.from, filter.to).toLowerCase() : isSearch ? null : t("transactions.empty.period", { period: period.subtitle ?? period.title }),
    isSearch && filter.q.trim() ? t("transactions.empty.search", { q: filter.q.trim() }) : null,
    n ? t("transactions.empty.filters", { count: n }) : null,
  ].filter(Boolean);
  const emptyList = (
    <Empty title={t("transactions.empty.title")}
      hint={narrowing.length ? t("transactions.empty.hint", { parts: narrowing.join(", ") }) : t("transactions.list.emptyHint")}
      action={{ label: t("transactions.empty.action"), onPress: showEverything }} />
  );
  const pickScope = () => router.push({ pathname: "/pick/option", params: { key: keys.scope, title: t("transactions.scopeTitle"), options: JSON.stringify(scopeOptions(accounts)), selected: scope || "all" } });

  // Multi-edit. `selected` is null outside selection mode.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selecting = selected !== null;
  const chosen = useMemo(() => (selected ? rows.filter((t) => selected.has(t.id)) : []), [rows, selected]);
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toggleRow = useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(rows.map((t) => t.id)));
  /** A row touched and held: selection mode, starting with that row. */
  const startSelect = useCallback((id: string) => setSelected(new Set([id])), []);
  // Switching to another tab ends selection mode. Search is on the root stack, over the tab bar, so
  // it never sees a tab switch; going back from it needs nothing: the screen is gone, and the next
  // one starts empty. The tab bar's own state, not `blur`: a sheet opened over the list — a picker,
  // the bulk preview — blurs this screen as well, and must not throw the selection away half way
  // through an edit.
  const searchRef = useRef<SearchBarCommands>(null);
  useEffect(() => {
    const tabs = navigation.getParent();
    if (!tabs || isSearch) return;
    return (tabs as unknown as { addListener: (type: "state", cb: (e: { data: { state: { index: number; routes: { name: string }[] } } }) => void) => () => void })
      .addListener("state", (e) => {
        const st = e.data.state;
        if (st.routes[st.index]?.name === "transactions") return;
        setSelected((s) => (s ? null : s));
      });
  }, [navigation, isSearch]);
  // Search opened on a category or a tag (from its editor) is there to show that list, so the
  // keyboard stays down over it; opened from the magnifying glass it is there to be typed into.
  const typing = isSearch && !p.category && !p.tag;
  // `autoFocus` alone does not always take while the push is still animating; focus again once it lands.
  useEffect(() => {
    if (!typing) return;
    return (navigation as unknown as { addListener: (type: "transitionEnd", cb: (e: { data: { closing: boolean } }) => void) => () => void })
      .addListener("transitionEnd", (e) => { if (!e.data.closing) searchRef.current?.focus(); });
  }, [navigation, typing]);
  /** The chosen rows plus the other leg of every chosen transfer: half a transfer is not a thing to edit. */
  const chosenIds = () => withTransferLegs(db, chosen.map((t) => t.id));
  /**
   * Nothing is written from this screen any more. Twelve rows changing at once has no undo and
   * leaves no trace to read afterwards, so every multi-edit goes through the preview first, which
   * lists what each row says now and would say after, and writes only when it is confirmed
   * (`/transaction/bulk`). Selection mode ends when it reports back, and stays put on Cancel.
   *
   * Only for a change that needs no picker — Confirm. Everything else answers through one, and a
   * picker hands its answer back a line before its own `router.back()`: both act on the same stack
   * in the same tick, so the preview pushed from the handler is exactly what that `back()` pops.
   * The sheet stays open on the category it opened with, the tick never moves, and changing the
   * category of a selection looks like it does nothing at all. `reviewAfterPick` is the way in
   * from there.
   */
  const review = (change: BulkChange) => {
    if (!chosen.length) return;
    router.push({ pathname: "/transaction/bulk", params: { key: keys.bulk, ids: chosenIds().join(","), change: JSON.stringify(change) } });
  };
  /**
   * The same preview, from a picker's answer: the rows are read now — the selection is what it was
   * when the question was asked — and the push waits for the sheet to be gone, because pushing into
   * an iOS dismissal is dropped outright (`DISMISS_MS`, see lib/nav.ts).
   */
  const reviewAfterPick = (change: BulkChange) => {
    if (!chosen.length) return;
    const ids = chosenIds().join(",");
    setTimeout(() => router.push({ pathname: "/transaction/bulk", params: { key: keys.bulk, ids, change: JSON.stringify(change) } }), DISMISS_MS);
  };
  usePickResult<number>(keys.bulk, useCallback(() => setSelected(null), []));
  // Move every chosen row to another day; each keeps its own time of day.
  const pickDate = () => {
    if (!chosen.length) return;
    const same = chosen.every((t) => t.date.slice(0, 10) === chosen[0]!.date.slice(0, 10)) ? chosen[0]!.date.slice(0, 10) : todayLocal();
    router.push({ pathname: "/pick/date", params: { key: keys.date, selected: same } });
  };
  usePickResult<string>(keys.date, useCallback((day: string) => reviewAfterPick({ kind: "date", day }), [chosen])); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteChosen = () => {
    if (!chosen.length) return;
    const transfers = chosen.filter((x) => x.transfer_id).length;
    Alert.alert(t("transactions.deleteTitle", { count: chosen.length }), transfers ? t("transactions.deleteTransfers") : undefined, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => { const ids = chosenIds(); mutate((d) => { for (const id of ids) remove(d, "transactions", id); }); setSelected(null); } },
    ]);
  };
  const pickCategory = () => {
    if (!chosen.length) return;
    const kind = chosen.every((t) => !t.transfer_id && t.amount_minor > 0) ? "income" : "expense";
    // Same category everywhere: preselect it. Mixed: nothing is ticked ("-" matches no row and is not empty).
    const same = chosen.every((t) => t.category_id === chosen[0]!.category_id) ? chosen[0]!.category_id ?? "" : "-";
    router.push({ pathname: "/pick/category", params: { key: keys.cat, kind, selected: same } });
  };
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => reviewAfterPick({ kind: "category", category_id: v }), [chosen])); // eslint-disable-line react-hooks/exhaustive-deps
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
    reviewAfterPick({ kind: "tags", add, drop });
  }, [chosen, shared])); // eslint-disable-line react-hooks/exhaustive-deps
  // The note every chosen row gets. Whether it replaces what is there or is added as a line is
  // asked on the preview screen, where the difference can be seen row by row.
  const pickNote = () => {
    if (!chosen.length) return;
    const same = chosen.every((t) => (t.notes ?? "") === (chosen[0]!.notes ?? "")) ? chosen[0]!.notes ?? "" : "";
    router.push({ pathname: "/pick/text", params: { key: keys.note, title: t("transactions.noteTitle"), value: same, multiline: "1" } });
  };
  usePickResult<string>(keys.note, useCallback((text: string) => reviewAfterPick({ kind: "note", text, mode: "replace" }), [chosen])); // eslint-disable-line react-hooks/exhaustive-deps
  const headerButton = (label: string, onPress: () => void, bold = false) => (
    <Pressable onPress={onPress} hitSlop={10} style={styles.headerText} accessibilityRole="button" accessibilityLabel={label}><ButtonText style={[styles.headerLink, bold && { fontWeight: "700" }]} maxFontSizeMultiplier={1.3}>{label}</ButtonText></Pressable>
  );
  const range = tripTag && filter.from === ALL_TIME && !filter.to ? "" : filter.from || filter.to ? rangeLabel(filter.from, filter.to) : filter.upcoming ? t("transactions.upcoming") : "";
  // What the screen was opened *about* — a category from Budgets, a tag or a category from its
  // editor — kept in the title beside the range. Dropped as soon as that filter is gone, so the
  // header never names something the list is no longer showing.
  const named = p.name && p.category && filter.categories.includes(p.category) ? catNameById(p.category, p.name) ?? p.name
    : p.name && p.tag && filter.tags.includes(p.tag) ? p.name : "";
  const tripName = useQuery((d) => (tripTag ? getRow(d, "tags", tripTag)?.name ?? t("transactions.travel") : ""), [tripTag]);
  const customTitle = [named || tripName, range].filter(Boolean).join(" · ");
  /**
   * The trip card on a list that already is that trip: its head shows the whole trip again and a
   * category line narrows to that category — both here, in place. Pushing them, as the card does from
   * anywhere else, stacked one copy of this list on another for every tap.
   */
  const showInTrip = (category?: string | null) => {
    setFilter((f) => ({ ...f, categories: category === undefined ? [] : [category ?? "none"] }));
    setSort("date"); setSortGen((g) => g + 1);
  };

  return (
    <>
      <Stack.Screen options={{ title: selecting ? t("transactions.selected", { count: chosen.length }) : custom ? customTitle : isSearch ? named || t("transactions.searchTitle") : t("transactions.title"), headerLargeTitle: !custom,
        headerLeft: selecting ? () => headerButton(allChosen ? t("transactions.deselectAll") : t("transactions.selectAll"), toggleAll) : undefined,
        // No Select button: a row touched and held starts selecting (TransactionList). Search carries
        // its filter and sort here; on Transactions they are in the bottom bar, and this is the way to Search.
        unstable_headerRightItems: () => selecting
          ? [{ type: "button", label: t("common.done"), variant: "done", onPress: () => setSelected(null), accessibilityLabel: t("common.done") }]
          : isSearch ? [
            { type: "button", label: sort === "date" ? t("transactions.bar.byDate") : t("transactions.bar.byAmount"), icon: { type: "sfSymbol", name: sort === "date" ? "arrow.up.arrow.down" : "arrow.down.to.line" }, selected: sort === "amount", onPress: toggleSort, sharesBackground: false,
              accessibilityLabel: sort === "date" ? t("transactions.bar.sortByAmount") : t("transactions.bar.sortByDate") },
            { type: "spacing", spacing: 8 },
            { type: "button", label: t("transactions.bar.filter"), icon: { type: "sfSymbol", name: "line.3.horizontal.decrease" }, selected: n > 0, onPress: openFilter, sharesBackground: false,
              ...(n ? { badge: { value: String(n) } } : {}), accessibilityLabel: n ? t("transactions.bar.filtersActiveA11y", { count: n }) : t("transactions.bar.filtersA11y") },
          ] : [
            { type: "button", label: t("transactions.searchTitle"), icon: { type: "sfSymbol", name: "magnifyingglass" }, onPress: () => router.push("/search"), accessibilityLabel: t("transactions.searchTitle") },
          ],
        headerSearchBarOptions: isSearch ? { ref: searchRef, placeholder: t("transactions.searchPlaceholder"), hideWhenScrolling: false, autoFocus: typing,
          onChangeText: (e) => { const text = e?.nativeEvent?.text ?? ""; setFilter((f) => (f.q === text ? f : { ...f, q: text })); },
          onCancelButtonPress: () => setFilter((f) => (f.q ? { ...f, q: "" } : f)) } : undefined }} />
      <TransactionList rows={sorted} flat={sort === "amount"} resetKey={`sort-${sortGen}`} onScroll={onScroll} selected={selected ?? undefined} onToggle={toggleRow} onSelect={startSelect} keyboardDismissMode={isSearch ? "on-drag" : undefined} empty={emptyList} header={
        <>
          {/* Same place as on Budgets: under the large title, so they scroll away with it instead of crowding the compact bar.
              Kept while selecting, only inert: taking them out moved every row under the finger up by their height. */}
          {!custom && !isSearch ? (
            <View style={[styles.pills, selecting && styles.inert]} pointerEvents={selecting ? "none" : "auto"} importantForAccessibility={selecting ? "no-hide-descendants" : "auto"}>
              <PeriodPill period={period} onPrev={() => setPeriod(shiftPeriod(period, -1))} onNext={() => setPeriod(shiftPeriod(period, 1))} onReset={() => setPeriod(currentPeriod())}
                onPick={() => router.push({ pathname: "/pick/month", params: { key: keys.month, selected: period.start } })} />
              <ScopePill label={scopeLabel(scope, accounts)} active={!!scope} onPress={pickScope} />
            </View>
          ) : null}
          {shownTrip ? <View style={[styles.trip, selecting && styles.inert]} pointerEvents={selecting ? "none" : "auto"}><TripCard budget={shownTrip} onShow={tripTag === shownTrip.tag_id ? showInTrip : undefined} /></View> : null}
          {/* Totals next — the month at a glance. Then what still needs a decision: recurring you owe, then entries to check. */}
          {/* An empty search with nothing filtered is every entry ever: totals over that answer nothing. */}
          {tripTag || (isSearch && !filter.q.trim() && !n) ? null : <StatPair stats={[
            ...(hideIncome ? [] : [{ label: t("transactions.income"), ...statOf(totals.totals[0]!, "income"), color: C.green }]),
            { label: t("transactions.expenses"), ...statOf(totals.totals[1]!, "expense"), color: C.red },
          ]} />}
          {/* Same words as Net worth uses, for the same reason: a total quietly missing a currency is worse than one that admits it. */}
          {missingRates.length ? (
            <Text style={styles.ratesWarn}>{fetchingRates ? t("transactions.rates.fetching", { currencies: missingRates.join(", ") }) : t("transactions.rates.missing", { currencies: missingRates.join(", ") })}</Text>
          ) : null}
          {dueRecurring.n > 0 || dueRecurring.waiting > 0 ? (
            <Pressable onPress={() => router.push("/recurring/due")} accessibilityRole="button"
              accessibilityLabel={`${dueTitle}. ${dueSub}`}
              style={({ pressed }) => [styles.due, pressed && { opacity: 0.7 }]}>
              <SymbolView name={dueRecurring.n ? "repeat.circle.fill" : "hourglass.circle.fill"} size={20} tintColor={dueRecurring.n ? C.red : C.secondary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pendingTitle}>{dueTitle}</Text>
                <Text style={styles.pendingSub}>{dueSub}</Text>
              </View>
              {dueRecurring.n && dueSum.totals[0]!.minor ? <Money minor={dueSum.totals[0]!.minor} currency={dueSum.currency} approx={dueSum.totals[0]!.approx} style={styles.dueSum} /> : null}
              <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
            </Pressable>
          ) : null}
          {pending.n > 0 ? (
            <Pressable onPress={() => router.push("/pending")} accessibilityRole="button" accessibilityLabel={`${t("transactions.pending.title", { count: pending.n })}. ${t("transactions.pending.sub")}`}
              style={({ pressed }) => [styles.pending, pressed && { opacity: 0.7 }]}>
              <SymbolView name="clock.badge.exclamationmark" size={20} tintColor={C.orange} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pendingTitle}>{t("transactions.pending.title", { count: pending.n })}</Text>
                <Text style={styles.pendingSub}>{t("transactions.pending.sub")}</Text>
              </View>
              {pendingSum.totals[0]!.minor ? <Money minor={pendingSum.totals[0]!.minor} currency={pendingSum.currency} approx={pendingSum.totals[0]!.approx} style={styles.pendingSum} /> : null}
              <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
            </Pressable>
          ) : null}
        </>
      } />
      {/* Nothing chosen yet: no bar at all. A `BarButton` that is merely inactive looks exactly like
          a working one — `active` only bolds its label — so a row of them above an empty selection
          reads as buttons that do nothing when tapped. The bar slides in with the first tick. */}
      <BottomBar visible={selecting ? chosen.length > 0 : visible && !isSearch}>
        {selecting ? (
          <>
            <BarButton icon="folder" label={t("transactions.bar.category")} active onPress={pickCategory} a11y={t("transactions.bar.categoryA11y", { count: chosen.length })} />
            <BarButton icon="number" active onPress={pickTags} a11y={t("transactions.bar.tagsA11y", { count: chosen.length })} />
            <BarButton icon="calendar" active onPress={pickDate} a11y={t("transactions.bar.dateA11y", { count: chosen.length })} />
            <BarButton icon="text.alignleft" active onPress={pickNote} a11y={t("transactions.bar.noteA11y", { count: chosen.length })} />
            {chosen.some((x) => x.pending) ? <BarButton icon="checkmark.circle" label={t("transactions.bar.confirm")} active onPress={() => review({ kind: "confirm" })} a11y={t("transactions.bar.confirmA11y", { count: chosen.filter((x) => x.pending).length })} /> : null}
            <BarButton icon="trash" color={C.red} onPress={deleteChosen} a11y={t("transactions.bar.deleteA11y", { count: chosen.length })} />
          </>
        ) : (
          <>
            {/* In the iPad column there is room for the words, and a column of icons alone is a
                puzzle; on a phone the bar is in the thumb zone and the count is all that fits. */}
            <BarButton icon="line.3.horizontal.decrease" label={isPad ? (n ? t("transactions.bar.filters", { count: n }) : t("transactions.bar.filter")) : n ? String(n) : undefined}
              active={n > 0} onPress={openFilter}
              onLongPress={askReset} a11y={n ? t("transactions.bar.filtersActiveA11y", { count: n }) : t("transactions.bar.filtersA11y")} a11yHint={t("transactions.bar.filtersHint")} />
            <BarButton icon={sort === "date" ? "arrow.up.arrow.down" : "arrow.down.to.line"} label={isPad ? (sort === "date" ? t("transactions.bar.byDate") : t("transactions.bar.byAmount")) : undefined}
              active={sort === "amount"} onPress={toggleSort} a11y={sort === "date" ? t("transactions.bar.sortByAmount") : t("transactions.bar.sortByDate")} />
            <LogButton />
          </>
        )}
      </BottomBar>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  inert: { opacity: 0.4 },
  pills: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.xs },
  trip: { paddingTop: S.sm },
  pending: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, paddingHorizontal: S.md, paddingVertical: 10, borderRadius: R.card, backgroundColor: C.orangeSoft },
  due: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, paddingHorizontal: S.md, paddingVertical: 10, borderRadius: R.card, backgroundColor: C.redSoft },
  dueSum: { fontSize: 16, fontWeight: "700", color: C.red },
  pendingTitle: { fontSize: 16, fontWeight: "600", color: C.label },
  pendingSub: { fontSize: 13, color: C.secondary },
  pendingSum: { fontSize: 16, fontWeight: "700", color: C.orange },
  headerLink: { color: C.tint, fontSize: 17 },
  // Room inside the glass capsule iOS draws around a header item: flush, the words touched its edges.
  headerText: { paddingHorizontal: 12, paddingVertical: 6 },
  ratesWarn: { color: C.orange, fontSize: 12, paddingHorizontal: S.xl, paddingBottom: S.xs },
}));
