import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { budgetCategoryIds, budgetRows, categorySpend, formatMinor, listRows, listTrips, oneCurrency, sumInBase, tagColor, tagSpend, tripTagIds } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { AmountPill, Card, CategoryIcon, CategoryIconStack, Empty, FadeIn, Money, ProgressBar, SectionHeader, StatPair } from "@/components/ui";
import { PeriodPill } from "@/components/PeriodPill";
import { TripCard } from "@/components/TripCard";
import { ScopePill } from "@/components/ScopePill";
import { C, R, S, themed } from "@/constants/theme";
import { periodLabel, todayLocal } from "@/lib/dates";
import { currentPeriod, getPeriodStartDay, periodContaining, shiftPeriod, usePeriod } from "@/lib/period";
import { getBaseCurrency, useRates } from "@/lib/rates";
import { useCloudRefresh } from "@/lib/backup";
import { getBudgetScope, getBudgetsSections, setBudgetScope, type BudgetsSection } from "@/lib/settings";
import { scopeAccount, scopeAccountIds, scopeLabel, scopeOptions } from "@/lib/scope";
import { catName } from "@/lib/names";
import { t } from "@/i18n";

type Line = { id: string | null; name: string; spent: number; icon: string | null; color: string | null };
/** A line of the Spending list: a folder, or — with `trip` set to its tag — everything a trip paid for. */
type Group = Line & { currency: string; children: Line[]; trip?: string };

/**
 * Home screen. Budgets for the period (shared ones, or the current account's own when
 * an account is the scope; the scope is the pill at the top right), then spending by folder. A folder expands to its categories;
 * tapping the folder or a category opens Transactions with just that filter.
 */
export default function BudgetsScreen() {
  const [period, setPeriod] = usePeriod();   // the same month Transactions is showing
  const { start, end } = period;
  // A period that is over has a verdict: at or under the limit is a budget kept.
  const ended = end <= useQuery(() => todayLocal());
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
  const pickScope = () => router.push({ pathname: "/pick/option", params: { key: keys.scope, title: t("budgets.scopePicker"), options: JSON.stringify(scopeOptions(accounts)), selected: scope || "all" } });

  // The same gesture as on Transactions, and the same hook behind it: re-read the database and look
  // in iCloud for what another device has backed up.
  const { refreshing, onRefresh } = useCloudRefresh();
  // The running trip lives on Transactions now, at the top of the list it is filling; what stays here
  // is the history, at the bottom.
  const pastTrips = useQuery((db) => listTrips(db)).filter((x) => x.ended);
  const [pastOpen, setPastOpen] = useState(false);
  const data = useQuery((db) => {
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
    const tags = new Map(listRows(db, "tags", "1=1").map((x) => [x.id, x]));
    const nm = (c: { name: string; preset?: string | null } | undefined) => (c ? catName(c) : undefined);
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
          ? (one && sc?.id === one.id ? t("budgets.direct") : nm(sc) ?? t("budgets.title.uncategorized"))
          : nm(top) ?? t("budgets.title.uncategorized");
        const e = merged.get(id ?? "none") ?? { id, name, spent: 0, icon: ref?.icon ?? null, color: ref?.color ?? null };
        e.spent += ch.spent_minor; merged.set(id ?? "none", e);
      }
      const scopeName = ids.map((cid) => (cid === "none" ? t("budgets.title.uncategorized") : nm(cats.get(cid)) ?? "?")).join(", ");
      // One entry per thing the budget was scoped to, in the order it was picked. A folder is one
      // entry wearing its own icon: a budget on a folder is not a budget on a list of categories.
      const scopeIcons = ids.map((cid) => {
        const sc = cid === "none" ? undefined : cats.get(cid);
        return { name: nm(sc) ?? t("budgets.title.uncategorized"), icon: sc?.icon ?? null, color: sc?.color ?? null };
      });
      return { id: b.id, name: b.name?.trim() || (tag ? tag.name : scopeName || t("budgets.title.everything")), named: !!b.name?.trim(), counted: b.in_planned !== 0, tag: tag?.id ?? null,
        // The folder above it places a single category; several of them place themselves.
        parent: tag ? t("budgets.edit.tag") : one?.parent_id ? nm(cats.get(one.parent_id)) ?? null : null,
        currency: b.currency, limit: b.amount_minor, spent: r.spent_minor,
        icon: tag ? "number" : one?.icon ?? null, color: tag ? tagColor(tag.name, tag.color) : one?.color ?? null,
        // Several categories have no one icon between them, so the row shows the pile (a tag has its own).
        icons: tag ? [] : scopeIcons, children: [...merged.values()].sort((a, z) => z.spent - a.spent) };
    });
    const groups = new Map<string, Group>();
    // A trip's spending is one line of its own rather than scattered over Food and Taxis: the
    // budgets above leave it out too (`budgetRows`), and the two have to tell the same story.
    const trips = tripTagIds(db);
    for (const s of categorySpend(db, start, end, scopeIds, { exceptTags: trips })) {
      const c = s.category_id ? cats.get(s.category_id) : undefined;
      const top = c?.parent_id ? cats.get(c.parent_id) : c;
      const key = `${top?.id ?? "none"}|${s.currency}`;
      const g = groups.get(key) ?? { id: top?.id ?? null, name: nm(top) ?? t("budgets.title.uncategorized"), currency: s.currency, spent: 0, icon: top?.icon ?? null, color: top?.color ?? null, children: [] };
      g.spent += -s.spent_minor;
      g.children.push({ id: c?.id ?? null, name: c ? (c.id === top?.id ? t("budgets.direct") : catName(c)) : t("budgets.title.uncategorized"), spent: -s.spent_minor, icon: c?.icon ?? null, color: c?.color ?? null });
      groups.set(key, g);
    }
    for (const tagId of trips) {
      const tag = tags.get(tagId);
      for (const s of tagSpend(db, tagId, { fromIso: start, toIso: end, accountIds: scopeIds, oneOff: true })) {
        const c = s.category_id ? cats.get(s.category_id) : undefined;
        const key = `trip:${tagId}|${s.currency}`;
        const g = groups.get(key) ?? { id: null, trip: tagId, name: tag?.name ?? t("budgets.travel"), currency: s.currency, spent: 0, icon: "airplane", color: "#0A84FF", children: [] };
        g.spent += -s.spent_minor;
        g.children.push({ id: c?.id ?? null, name: nm(c) ?? t("budgets.title.uncategorized"), spent: -s.spent_minor, icon: c?.icon ?? null, color: c?.color ?? null });
        groups.set(key, g);
      }
    }
    return { rows, spending: [...groups.values()].map((g) => ({ ...g, children: g.children.sort((a, b) => b.spent - a.spent) })).sort((a, b) => b.spent - a.spent) };
  }, [start, end, scopeIds.join(","), budgetAccount]);

  const { rateFor } = useRates([...new Set([...data.rows, ...data.spending].map((r) => r.currency))], base);
  // A budget switched out of the totals keeps its bar below but stays out of these two numbers, so
  // a limit kept as a yardstick does not read as money set aside (`/budget/planned` is the switch).
  const counted = data.rows.filter((r) => r.counted);
  const planned = sumInBase(counted.map((r) => ({ currency: r.currency, minor: r.limit })), base, rateFor);
  const available = sumInBase(counted.map((r) => ({ currency: r.currency, minor: r.limit - r.spent })), base, rateFor);
  const exceeded = data.rows.filter((r) => r.spent > r.limit).length;
  // What the categories below add up to. Spending is grouped per currency, so a month with a foreign
  // card in it lists the same category twice and there was no one number to read off the section at
  // all; `oneCurrency` keeps a single-currency month exact and only converts a genuinely mixed one.
  const spendingTotal = oneCurrency([data.spending.map((g) => ({ currency: g.currency, minor: -g.spent }))], base, rateFor);
  /**
   * The transactions a line is made of. Both filters travel, not just the category: a line under a
   * tag budget is what that category cost *while carrying the tag*, so opening it on the category
   * alone would show more money than the line says — every other Shopping row of the month included.
   */
  const openCategory = (id: string | null | undefined, name: string, tag?: string | null) => router.push({ pathname: "/transactions", params: { ...(id !== undefined ? { category: id ?? "none" } : {}), name, ...(tag ? { tag } : {}), from: start, to: end, accounts: scopeIds.join(","), nonce: String(Date.now()) } });
  /** A trip's line in Spending: everything with its tag in this period, whatever the category. */
  const openTrip = (tag: string, name: string) => openCategory(undefined, name, tag);
  const toggle = (key: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; }); };

  // The sections in the order chosen on the reorder screen (Settings key `budgets_sections`).
  const sections = useQuery(() => getBudgetsSections());
  const blocks: Record<BudgetsSection, ReactNode> = {
    budgets: (
      <>
          {data.rows.length ? (
            <StatPair stats={[
              { label: data.rows.length > counted.length ? t("budgets.plannedOf", { counted: counted.length, total: data.rows.length }) : t("budgets.planned.title"), minor: planned.minor, currency: base, color: C.green, onPress: () => router.push("/budget/planned") },
              { label: t("budgets.available"), minor: available.minor, currency: base, color: available.minor < 0 ? C.orange : undefined, onPress: () => router.push("/budget/planned") },
            ]} />
          ) : null}
          {/* Worth knowing, not a scolding: going over one line is usually made up somewhere else. */}
          {exceeded ? (
            <View style={[styles.note, styles.noteRow]}>
              <SymbolView name="lightbulb" size={16} tintColor={C.orange} />
              <Text style={[styles.noteText, { flex: 1 }]}>{ended ? t("budgets.exceededEnded", { count: exceeded }) : t("budgets.exceeded", { count: exceeded })}</Text>
            </View>
          ) : null}
          {data.rows.length === 0 ? <Empty title={budgetAccount ? t("budgets.emptyFor", { account: scopeName }) : t("budgets.empty")} hint={t("budgets.emptyHint")} /> : null}
          {data.rows.length ? (
            <SectionHeader right={data.rows.length > 1 || data.spending.length || pastTrips.length
              ? <Pressable onPress={() => router.push("/budget/reorder")} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("budgets.reorder.title")}><Text style={styles.addText}>{t("budgets.reorder.button")}</Text></Pressable>
              : undefined}>{scope ? t("budgets.monthlyScoped", { period: period.subtitle ?? period.title, scope: scopeName }) : t("budgets.monthly", { period: period.subtitle ?? period.title })}</SectionHeader>
          ) : null}
          {data.rows.map((b, bi) => {
            const ratio = b.limit > 0 ? Math.min(1, b.spent / b.limit) : 0;
            const over = b.spent > b.limit;
            // A budget met to the cent is a small win and gets said as one, not as "0.00" over an empty
            // bar; a period that is over and came in at or under the limit is one too — with what was
            // left over, when there was some. Going over is orange: a warning about the rest of the
            // month, not an error.
            const exact = b.spent === b.limit && b.limit > 0;
            const kept = ended && !over;
            const saved = b.limit - b.spent;
            const status = over ? t("budgets.status.exceeded") : exact ? t("budgets.status.exact") : kept ? t("budgets.status.saved", { amount: `${formatMinor(saved, b.currency)} ${b.currency}` }) : t("budgets.available");
            return (
              <FadeIn key={b.id} delay={bi * 40} style={styles.budget}>
                <Pressable onPress={() => router.push({ pathname: "/budget/edit", params: { id: b.id } })} onLongPress={data.rows.length > 1 ? () => router.push("/budget/reorder") : undefined}
                  style={styles.budgetHead} accessibilityRole="button" accessibilityLabel={t("budgets.editLabel", { name: b.name })} accessibilityHint={data.rows.length > 1 ? t("budgets.reorderHint") : undefined}>
                  {b.icons.length > 1
                    ? <CategoryIconStack items={b.icons} size={34} />
                    : <CategoryIcon name={b.name} icon={b.icon} color={b.color} size={34} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.budgetName} numberOfLines={2}>{b.parent ? `${b.parent} › ` : ""}{b.name}</Text>
                    <Text style={styles.budgetSub}>{periodLabel(start, end)} · {status}{b.counted ? "" : ` · ${t("budgets.notInPlanned")}`}</Text>
                  </View>
                  {exact || kept ? (
                    <View style={styles.celebrate} accessibilityLabel={exact ? t("budgets.status.metLabel") : t("budgets.status.keptLabel", { amount: `${formatMinor(saved, b.currency)} ${b.currency}` })}>
                      <SymbolView name="party.popper.fill" size={18} tintColor={C.green} />
                      {saved > 0 ? <Money minor={saved} currency={b.currency} sign style={styles.celebrateText} /> : null}
                    </View>
                  ) : <AmountPill minor={b.limit - b.spent} currency={b.currency} warn />}
                </Pressable>
                {/* Only while there is a difference to show: a full green bar at "0.00" says nothing the badge does not. */}
                {exact ? null : <ProgressBar ratio={ratio} color={over || ratio > 0.85 ? C.orange : C.green} />}
                {/* The categories it was spent on fold away behind the amount line: the whole row is the
                    toggle, so it is a comfortable target rather than a small arrow to aim for. */}
                {b.children.length ? (
                  <Pressable onPress={() => toggle(`budget:${b.id}`)} style={styles.foldRow} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button"
                    accessibilityLabel={`${t("budgets.spentOf", { spent: fmt(b.spent), limit: fmt(b.limit), currency: b.currency })}. ${expanded.has(`budget:${b.id}`) ? t("budgets.hideCategories", { count: b.children.length }) : t("budgets.showCategories", { count: b.children.length })}`}
                    accessibilityState={{ expanded: expanded.has(`budget:${b.id}`) }}>
                    <Text style={[styles.budgetSub, { flex: 1 }]}>{t("budgets.spentOf", { spent: fmt(b.spent), limit: fmt(b.limit), currency: b.currency })} · {t("budgets.edit.categoriesCount", { count: b.children.length })}</Text>
                    <SymbolView name={expanded.has(`budget:${b.id}`) ? "chevron.up" : "chevron.down"} size={13} tintColor={C.secondary} />
                  </Pressable>
                ) : <Text style={styles.budgetSub}>{t("budgets.spentOf", { spent: fmt(b.spent), limit: fmt(b.limit), currency: b.currency })}</Text>}
                {expanded.has(`budget:${b.id}`) && b.children.map((ch) => (
                  <Pressable key={ch.id ?? "none"} onPress={() => openCategory(ch.id, b.tag ? `${b.name} · ${ch.name}` : ch.name, b.tag)} style={styles.child} accessibilityRole="button" accessibilityLabel={b.tag ? t("budgets.childTaggedLabel", { name: ch.name, tag: b.name }) : t("budgets.childLabel", { name: ch.name })}>
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
            <Text style={styles.addText}>{budgetAccount ? t("budgets.addFor", { account: scopeName }) : t("budgets.add")}</Text>
          </Pressable>
      </>
    ),
    spending: (
      <>
          {data.spending.length ? <SectionHeader>{scope ? t("budgets.spending.headerScoped", { period: period.subtitle ?? period.title, scope: scopeName }) : t("budgets.spending.header", { period: period.subtitle ?? period.title })}</SectionHeader> : null}
          {data.spending.length ? (
            <Card>
              {data.spending.map((g, i) => {
                const key = g.trip ? `trip:${g.trip}|${g.currency}` : `${g.id ?? "none"}|${g.currency}`;
                const open = expanded.has(key);
                const expandable = g.trip ? g.children.length > 1 : g.id !== null && (g.children.length > 1 || g.children[0]?.id !== g.id);
                const openAll = () => (g.trip ? openTrip(g.trip, g.name) : openCategory(g.id, g.name));
                return (
                  <View key={key}>
                    <Pressable onPress={() => (expandable ? toggle(key) : g.trip ? openCategory(g.children[0]?.id ?? null, g.name, g.trip) : openCategory(g.id, g.name))} style={[styles.spendRow, i > 0 && styles.divider]} accessibilityRole="button" accessibilityLabel={`${g.name}, ${g.spent / 100} ${g.currency}`} accessibilityState={{ expanded: open }}>
                      <CategoryIcon name={g.name} icon={g.icon} color={g.color} size={28} />
                      <Text style={styles.spendName}>{g.name}</Text>
                      <Money minor={-g.spent} currency={g.currency} />
                      <SymbolView name={expandable ? (open ? "chevron.down" : "chevron.right") : "chevron.right"} size={12} tintColor={C.tertiary} />
                    </Pressable>
                    {open ? (
                      <View style={styles.children}>
                        <Pressable onPress={openAll} style={styles.childRow} accessibilityRole="button" accessibilityLabel={t("budgets.spending.allLabel", { name: g.name })}>
                          <SymbolView name={g.trip ? "airplane" : "folder"} size={14} tintColor={C.tint} />
                          <Text style={[styles.childText, { color: C.tint, fontWeight: "600" }]}>{t("budgets.spending.allIn", { name: g.name })}</Text>
                          <SymbolView name="chevron.right" size={11} tintColor={C.tertiary} />
                        </Pressable>
                        {g.children.map((ch) => (
                          <Pressable key={ch.id ?? "none"} onPress={() => openCategory(ch.id, ch.name, g.trip)} style={styles.childRow} accessibilityRole="button" accessibilityLabel={t("budgets.childLabel", { name: ch.name })}>
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
                <View accessible style={[styles.spendRow, styles.divider]} accessibilityLabel={t("budgets.spending.totalLabel", { amount: `${formatMinor(spendingTotal.totals[0]!.minor, spendingTotal.currency)} ${spendingTotal.currency}` })}>
                  <Text style={[styles.spendName, styles.totalName]}>{t("budgets.spending.total")}</Text>
                  <Money minor={spendingTotal.totals[0]!.minor} currency={spendingTotal.currency} approx={spendingTotal.totals[0]!.approx} style={styles.totalAmt} />
                </View>
              ) : null}
            </Card>
          ) : null}
          {spendingTotal.missing.length ? <Text style={styles.ratesWarn}>{t("budgets.spending.noRate", { currencies: spendingTotal.missing.join(", ") })}</Text> : null}
      </>
    ),
    travel: (
      <>
          {pastTrips.length ? (
            <SectionHeader right={pastTrips.length > 3 ? <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setPastOpen((v) => !v); }} accessibilityRole="button" accessibilityLabel={pastOpen ? t("budgets.travelHistory.hideLabel") : t("budgets.travelHistory.showLabel")}><Text style={styles.addText}>{pastOpen ? t("budgets.travelHistory.hide") : t("budgets.travelHistory.show", { count: pastTrips.length })}</Text></Pressable> : undefined}>{t("budgets.travelHistory.title")}</SectionHeader>
          ) : null}
          {(pastTrips.length > 3 ? (pastOpen ? pastTrips : []) : pastTrips).map((x) => <TripCard key={x.id} budget={x} compact />)}
      </>
    ),
  };
  return (
    <>
      <Stack.Screen options={{ title: t("budgets.screenTitle"), headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {/* Period and scope live in the content, not the native header: once scrolled they leave with the large title instead of crowding the compact "Budgets" bar. */}
        <View style={styles.pills}>
          <PeriodPill period={period} onPrev={() => setPeriod(shiftPeriod(period, -1))} onNext={() => setPeriod(shiftPeriod(period, 1))} onReset={() => setPeriod(currentPeriod())}
            onPick={() => router.push({ pathname: "/pick/month", params: { key: keys.month, selected: period.start, now: currentPeriod().start } })} />
          <ScopePill label={scopeName} active={!!scope} onPress={pickScope} />
        </View>
        {sections.map((sec) => <Fragment key={sec}>{blocks[sec]}</Fragment>)}
      </ScrollView>
    </>
  );
}

function fmt(minor: number) { return (minor / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

const styles = themed(() => StyleSheet.create({
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: S.lg, height: 44, borderRadius: R.card, borderWidth: 1, borderStyle: "dashed", borderColor: C.tint },
  addText: { color: C.tint, fontSize: 15, fontWeight: "600" },
  pills: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.xs },
  noteRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  note: { marginHorizontal: S.lg, marginTop: S.md, backgroundColor: C.card, borderRadius: R.card, padding: S.md },
  noteText: { color: C.label, fontSize: 15 },
  budget: { marginHorizontal: S.lg, marginBottom: S.sm, backgroundColor: C.card, borderRadius: R.card, padding: S.md, gap: 6 },
  budgetHead: { flexDirection: "row", alignItems: "center", gap: S.sm },
  budgetName: { fontSize: 17, fontWeight: "600", color: C.label },
  budgetSub: { fontSize: 13, color: C.secondary },
  celebrate: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: C.greenSoft },
  celebrateText: { fontSize: 15, fontWeight: "600", color: C.green },
  foldRow: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 36 },
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
}));
