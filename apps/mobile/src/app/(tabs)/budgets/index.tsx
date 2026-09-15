import { useCallback, useMemo, useState } from "react";
import { Alert, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { budgetCategoryIds, budgetRows, categorySpend, formatMinor, listRows, listTrips, oneCurrency, remove, sumInBase, tagColor, tripStats, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { AmountPill, Card, CategoryIcon, CategoryIconStack, Empty, FadeIn, Money, ProgressBar, SectionHeader, StatPair } from "@/components/ui";
import { PeriodPill } from "@/components/PeriodPill";
import { TripCard } from "@/components/TripCard";
import { ScopePill } from "@/components/ScopePill";
import { C, R, S } from "@/constants/theme";
import { periodLabel } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { getBudgetScope, setBudgetScope } from "@/lib/settings";
import { scopeAccount, scopeAccountIds, scopeLabel, scopeOptions } from "@/lib/scope";

type Line = { id: string | null; name: string; spent: number; icon: string | null; color: string | null };

/**
 * Home screen. Budgets for the period (shared ones, or the current account's own when
 * an account is the scope; the scope is the pill at the top right), then spending by folder. A folder expands to its categories;
 * tapping the folder or a category opens Transactions with just that filter.
 */
export default function BudgetsScreen() {
  const [period, setPeriod] = usePeriod();   // the same month Transactions is showing
  const { start, end } = period;
  const base = useQuery(() => getBaseCurrency());
  const scope = useQuery(() => getBudgetScope());
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  const scopeIds = useMemo(() => scopeAccountIds(scope, accounts), [scope, accounts]);
  const budgetAccount = scopeAccount(scope);
  const scopeName = scopeLabel(scope, accounts);
  const keys = useMemo(() => ({ scope: newPickKey("scope"), month: newPickKey("month") }), []);
  usePickResult<string>(keys.scope, useCallback((v: string) => setBudgetScope(v === "all" ? "" : v), []));
  usePickResult<string>(keys.month, useCallback((d: string) => setPeriod(periodContaining(`${d.slice(0, 8)}${String(Math.min(getPeriodStartDay(), 28)).padStart(2, "0")}`)), []));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const pickScope = () => router.push({ pathname: "/pick/option", params: { key: keys.scope, title: "Spending from", options: JSON.stringify(scopeOptions(accounts)), selected: scope || "all" } });

  const trips = useQuery((db) => listTrips(db));
  const activeTrips = trips.filter((t) => !t.ended), pastTrips = trips.filter((t) => t.ended);
  const [pastOpen, setPastOpen] = useState(false);
  const data = useQuery((db) => {
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
    const tags = new Map(listRows(db, "tags", "1=1").map((t) => [t.id, t]));
    const rows = budgetRows(db, { start, end, accountIds: scopeIds, budgetAccount }).map((r) => {
      const b = r.budget;
      const ids = budgetCategoryIds(b);
      const scoped = ids.length > 0;
      const one = ids.length === 1 ? cats.get(ids[0]!) : undefined;
      const tag = b.tag_id ? tags.get(b.tag_id) : undefined;
      const merged = new Map<string, Line>();
      for (const ch of r.children) {
        // A scoped budget breaks down by the categories that were actually spent in; an overall one
        // by folder, because otherwise the list is every category you own.
        const sc = ch.category_id ? cats.get(ch.category_id) : undefined;
        const top = sc?.parent_id ? cats.get(sc.parent_id) : sc;
        const ref = scoped ? sc : top;
        const id = scoped ? sc?.id ?? null : top?.id ?? null;
        // "Direct" only makes sense against a single named scope — with several, each line is named.
        const name = scoped
          ? (one && sc?.id === one.id ? "Direct" : sc?.name ?? "Uncategorized")
          : top?.name ?? "Uncategorized";
        const e = merged.get(id ?? "none") ?? { id, name, spent: 0, icon: ref?.icon ?? null, color: ref?.color ?? null };
        e.spent += ch.spent_minor; merged.set(id ?? "none", e);
      }
      const scopeName = ids.map((cid) => (cid === "none" ? "Uncategorized" : cats.get(cid)?.name ?? "?")).join(", ");
      // One entry per thing the budget was scoped to, in the order it was picked. A folder is one
      // entry wearing its own icon: a budget on a folder is not a budget on a list of categories.
      const scopeIcons = ids.map((cid) => {
        const sc = cid === "none" ? undefined : cats.get(cid);
        return { name: sc?.name ?? "Uncategorized", icon: sc?.icon ?? null, color: sc?.color ?? null };
      });
      return { id: b.id, name: tag ? tag.name : scopeName || "Everything",
        // The folder above it places a single category; several of them place themselves.
        parent: tag ? "Tag" : one?.parent_id ? cats.get(one.parent_id)?.name ?? null : null,
        currency: b.currency, limit: b.amount_minor, spent: r.spent_minor,
        icon: tag ? "number" : one?.icon ?? null, color: tag ? tagColor(tag.name, tag.color) : one?.color ?? null,
        // Several categories have no one icon between them, so the row shows the pile (a tag has its own).
        icons: tag ? [] : scopeIcons, children: [...merged.values()].sort((a, z) => z.spent - a.spent) };
    });
    const groups = new Map<string, Line & { currency: string; children: Line[] }>();
    for (const s of categorySpend(db, start, end, scopeIds)) {
      const c = s.category_id ? cats.get(s.category_id) : undefined;
      const top = c?.parent_id ? cats.get(c.parent_id) : c;
      const key = `${top?.id ?? "none"}|${s.currency}`;
      const g = groups.get(key) ?? { id: top?.id ?? null, name: top?.name ?? "Uncategorized", currency: s.currency, spent: 0, icon: top?.icon ?? null, color: top?.color ?? null, children: [] };
      g.spent += -s.spent_minor;
      g.children.push({ id: c?.id ?? null, name: c ? (c.id === top?.id ? "Direct" : c.name) : "Uncategorized", spent: -s.spent_minor, icon: c?.icon ?? null, color: c?.color ?? null });
      groups.set(key, g);
    }
    return { rows, spending: [...groups.values()].map((g) => ({ ...g, children: g.children.sort((a, b) => b.spent - a.spent) })).sort((a, b) => b.spent - a.spent) };
  }, [start, end, scopeIds.join(","), budgetAccount]);

  const { rateFor } = useRates([...new Set([...data.rows, ...data.spending].map((r) => r.currency))], base);
  const planned = sumInBase(data.rows.map((r) => ({ currency: r.currency, minor: r.limit })), base, rateFor);
  const available = sumInBase(data.rows.map((r) => ({ currency: r.currency, minor: r.limit - r.spent })), base, rateFor);
  const exceeded = data.rows.filter((r) => r.spent > r.limit).length;
  // What the categories below add up to. Spending is grouped per currency, so a month with a foreign
  // card in it lists the same category twice and there was no one number to read off the section at
  // all; `oneCurrency` keeps a single-currency month exact and only converts a genuinely mixed one.
  const spendingTotal = oneCurrency([data.spending.map((g) => ({ currency: g.currency, minor: -g.spent }))], base, rateFor);
  const openCategory = (id: string | null, name: string) => router.push({ pathname: "/transactions", params: { category: id ?? "none", name, from: start, to: end, accounts: scopeIds.join(","), nonce: String(Date.now()) } });
  const toggle = (key: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; }); };
  const removeTrip = (t: Budget) => {
    const s = tripStats(db, t);
    Alert.alert("Remove this trip?", `${s.name} · ${formatMinor(s.spent_minor, s.currency)} of ${formatMinor(s.limit_minor, s.currency)} ${s.currency}. The tag and the transactions stay; only the trip budget is removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => mutate((d) => remove(d, "budgets", t.id)) },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: "Budgets", headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Period and scope live in the content, not the native header: once scrolled they leave with the large title instead of crowding the compact "Budgets" bar. */}
        <View style={styles.pills}>
          <PeriodPill period={period} onPrev={() => setPeriod(shiftPeriod(period, -1))} onNext={() => setPeriod(shiftPeriod(period, 1))} onReset={() => setPeriod(currentPeriod())}
            onPick={() => router.push({ pathname: "/pick/month", params: { key: keys.month, selected: period.start, now: currentPeriod().start } })} />
          <ScopePill label={scopeName} active={!!scope} onPress={pickScope} />
        </View>
        {activeTrips.length ? <SectionHeader>Travel mode</SectionHeader> : null}
        {activeTrips.map((t) => <FadeIn key={t.id}><TripCard budget={t} /></FadeIn>)}
        {data.rows.length ? (
          <StatPair stats={[
            { label: "Planned", minor: planned.minor, currency: base, color: C.green },
            { label: "Available", minor: available.minor, currency: base, color: available.minor < 0 ? C.red : undefined },
          ]} />
        ) : null}
        {exceeded ? <View style={styles.note}><Text style={styles.noteText}>You have exceeded {exceeded} budget{exceeded > 1 ? "s" : ""} 😢</Text></View> : null}
        {data.rows.length === 0 ? <Empty title={budgetAccount ? `No budgets for ${scopeName} yet` : "No budgets yet"} hint="Set a limit for a category or for everything; it renews every period." /> : null}
        {data.rows.length ? <SectionHeader>Monthly · {period.subtitle ?? period.title}{scope ? ` · ${scopeName}` : ""}</SectionHeader> : null}
        {data.rows.map((b, bi) => {
          const ratio = b.limit > 0 ? Math.min(1, b.spent / b.limit) : 0;
          const over = b.spent > b.limit;
          return (
            <FadeIn key={b.id} delay={bi * 40} style={styles.budget}>
              <Pressable onPress={() => router.push({ pathname: "/budget/edit", params: { id: b.id } })} style={styles.budgetHead} accessibilityRole="button" accessibilityLabel={`Edit budget ${b.name}`}>
                {b.icons.length > 1
                  ? <CategoryIconStack items={b.icons} size={34} />
                  : <CategoryIcon name={b.name} icon={b.icon} color={b.color} size={34} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.budgetName} numberOfLines={2}>{b.parent ? `${b.parent} › ` : ""}{b.name}</Text>
                  <Text style={styles.budgetSub}>{periodLabel(start, end)} · {over ? "Exceeded" : "Available"}</Text>
                </View>
                <AmountPill minor={b.limit - b.spent} currency={b.currency} />
              </Pressable>
              <ProgressBar ratio={ratio} color={over ? C.red : ratio > 0.85 ? C.orange : C.green} />
              <Text style={styles.budgetSub}>{fmt(b.spent)} of {fmt(b.limit)} {b.currency}</Text>
              {b.children.map((ch) => (
                <Pressable key={ch.id ?? "none"} onPress={() => openCategory(ch.id, ch.name)} style={styles.child} accessibilityRole="button" accessibilityLabel={`${ch.name} transactions`}>
                  <CategoryIcon name={ch.name} icon={ch.icon} color={ch.color} size={24} />
                  <Text style={styles.childName}>{ch.name}</Text>
                  <Money minor={-ch.spent} currency={b.currency} style={styles.childAmt} />
                  <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
                </Pressable>
              ))}
            </FadeIn>
          );
        })}
        <Pressable onPress={() => router.push({ pathname: "/budget/edit", params: { id: "new", ...(budgetAccount ? { account: budgetAccount } : {}) } })} style={styles.addRow} accessibilityRole="button">
          <SymbolView name="plus.circle" size={18} tintColor={C.tint} />
          <Text style={styles.addText}>Add budget{budgetAccount ? ` for ${scopeName}` : ""}</Text>
        </Pressable>
        {data.spending.length ? <SectionHeader>Spending · {period.subtitle ?? period.title}{scope ? ` · ${scopeName}` : ""}</SectionHeader> : null}
        {data.spending.length ? (
          <Card>
            {data.spending.map((g, i) => {
              const key = `${g.id ?? "none"}|${g.currency}`;
              const open = expanded.has(key);
              const expandable = g.id !== null && (g.children.length > 1 || g.children[0]?.id !== g.id);
              return (
                <View key={key}>
                  <Pressable onPress={() => (expandable ? toggle(key) : openCategory(g.id, g.name))} style={[styles.spendRow, i > 0 && styles.divider]} accessibilityRole="button" accessibilityLabel={`${g.name}, ${g.spent / 100} ${g.currency}`} accessibilityState={{ expanded: open }}>
                    <CategoryIcon name={g.name} icon={g.icon} color={g.color} size={28} />
                    <Text style={styles.spendName}>{g.name}</Text>
                    <Money minor={-g.spent} currency={g.currency} />
                    <SymbolView name={expandable ? (open ? "chevron.down" : "chevron.right") : "chevron.right"} size={12} tintColor={C.tertiary} />
                  </Pressable>
                  {open ? (
                    <View style={styles.children}>
                      <Pressable onPress={() => openCategory(g.id, g.name)} style={styles.childRow} accessibilityRole="button" accessibilityLabel={`All ${g.name} transactions`}>
                        <SymbolView name="folder" size={14} tintColor={C.tint} />
                        <Text style={[styles.childText, { color: C.tint, fontWeight: "600" }]}>All in {g.name}</Text>
                        <SymbolView name="chevron.right" size={11} tintColor={C.tertiary} />
                      </Pressable>
                      {g.children.map((ch) => (
                        <Pressable key={ch.id ?? "none"} onPress={() => openCategory(ch.id, ch.name)} style={styles.childRow} accessibilityRole="button" accessibilityLabel={`${ch.name} transactions`}>
                          <CategoryIcon name={ch.name} icon={ch.icon} color={ch.color} size={20} />
                          <Text style={styles.childText}>{ch.name}</Text>
                          <Money minor={-ch.spent} currency={g.currency} style={styles.childAmt} />
                          <SymbolView name="chevron.right" size={11} tintColor={C.tertiary} />
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {/* Only worth a line when there is more than one thing to add up. */}
            {data.spending.length > 1 ? (
              <View accessible style={[styles.spendRow, styles.divider]} accessibilityLabel={`Total spending ${spendingTotal.totals[0]! / 100} ${spendingTotal.currency}`}>
                <Text style={[styles.spendName, styles.totalName]}>Total</Text>
                <Money minor={spendingTotal.totals[0]!} currency={spendingTotal.currency} approx={spendingTotal.approx} style={styles.totalAmt} />
              </View>
            ) : null}
          </Card>
        ) : null}
        {spendingTotal.missing.length ? <Text style={styles.ratesWarn}>No rate yet for {spendingTotal.missing.join(", ")}, so it is left out of the total.</Text> : null}
        {pastTrips.length ? (
          <SectionHeader right={pastTrips.length > 3 ? <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setPastOpen((v) => !v); }} accessibilityRole="button" accessibilityLabel={pastOpen ? "Hide past trips" : "Show past trips"}><Text style={styles.addText}>{pastOpen ? "Hide" : `Show ${pastTrips.length}`}</Text></Pressable> : undefined}>Past trips</SectionHeader>
        ) : null}
        {(pastTrips.length > 3 ? (pastOpen ? pastTrips : []) : pastTrips).map((t) => <TripCard key={t.id} budget={t} compact onRemove={() => removeTrip(t)} />)}
      </ScrollView>
    </>
  );
}

function fmt(minor: number) { return (minor / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

const styles = StyleSheet.create({
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: S.lg, height: 44, borderRadius: R.card, borderWidth: 1, borderStyle: "dashed", borderColor: C.tint },
  addText: { color: C.tint, fontSize: 15, fontWeight: "600" },
  pills: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.xs },
  note: { marginHorizontal: S.lg, marginTop: S.md, backgroundColor: C.card, borderRadius: R.card, padding: S.md },
  noteText: { color: C.label, fontSize: 15 },
  budget: { marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: C.card, borderRadius: R.card, padding: S.md, gap: 6 },
  budgetHead: { flexDirection: "row", alignItems: "center", gap: S.sm },
  budgetName: { fontSize: 17, fontWeight: "600", color: C.label },
  budgetSub: { fontSize: 13, color: C.secondary },
  child: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, marginTop: 4 },
  childName: { flex: 1, fontSize: 15, color: C.label },
  childAmt: { fontSize: 15, color: C.secondary },
  spendRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, minHeight: 46 },
  spendName: { flex: 1, fontSize: 16, color: C.label },
  totalName: { fontWeight: "600" },
  totalAmt: { fontWeight: "700" },
  ratesWarn: { color: C.orange, fontSize: 12, paddingHorizontal: S.xl, paddingTop: S.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  children: { backgroundColor: C.bgGrouped, paddingVertical: 4, paddingLeft: S.lg + 36, paddingRight: S.lg },
  childRow: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 40 },
  childText: { flex: 1, fontSize: 15, color: C.label },
});
