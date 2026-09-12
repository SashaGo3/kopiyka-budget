import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { BigButton, Card, Chip, ChipRow, ModalHeader, Row, SectionHeader, Segmented } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { ALL_TIME, EMPTY_FILTER, prevDay, rangeLabel, type TxFilter, type TxType } from "@/lib/filters";
import { currentPeriod, shiftPeriod } from "@/lib/period";
import { humanDayTime, monthBounds, shiftMonth, todayLocal } from "@/lib/dates";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Type and status first, then the period, then accounts / categories / tags chosen in their own sheets. */
export default function FilterScreen() {
  const { key, value } = useLocalSearchParams<{ key: string; value?: string }>();
  const [f, setF] = useState<TxFilter>(() => { try { return { ...EMPTY_FILTER, ...(value ? JSON.parse(value) : {}) }; } catch { return EMPTY_FILTER; } });
  const insets = useSafeAreaInsets();
  const names = useQuery((db) => ({
    accounts: new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a.name])),
    categories: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c.name])),
    tags: new Map(listRows(db, "tags", "1=1").map((t) => [t.id, t.name])),
  }));
  const keys = useMemo(() => ({ from: newPickKey("ffrom"), to: newPickKey("fto"), acc: newPickKey("facc"), cat: newPickKey("fcat"), tag: newPickKey("ftag") }), []);
  usePickResult<string>(keys.from, useCallback((d: string) => setF((s) => ({ ...s, from: d })), []));
  usePickResult<string>(keys.to, useCallback((d: string) => { const [y, m, dd] = d.split("-").map(Number) as [number, number, number]; const next = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); setF((s) => ({ ...s, to: next })); }, []));
  usePickResult<string[]>(keys.acc, useCallback((ids: string[]) => setF((s) => ({ ...s, accounts: ids })), []));
  usePickResult<string[]>(keys.cat, useCallback((ids: string[]) => setF((s) => ({ ...s, categories: ids })), []));
  usePickResult<string[]>(keys.tag, useCallback((ids: string[]) => setF((s) => ({ ...s, tags: ids })), []));
  const apply = () => { resolvePick(key, f); router.back(); };
  const cur = currentPeriod(), prev = shiftPeriod(cur, -1);
  const month = monthBounds(todayLocal()), lastMonth = monthBounds(shiftMonth(month.start, -1));
  const range = (from: string | null, to: string | null) => setF((s) => ({ ...s, from, to }));
  const is = (from: string | null, to: string | null) => f.from === from && f.to === to;
  const year = `${todayLocal().slice(0, 4)}-01-01`;
  const list = (ids: string[], map: Map<string, string>, none: string, fallback: string) => ids.length ? ids.map((id) => (id === "none" ? "Uncategorized" : map.get(id) ?? fallback)).join(", ") : none;
  const custom = !!(f.from || f.to);
  const active: { key: string; label: string; remove: () => void }[] = [
    ...(f.type ? [{ key: "type", label: f.type, remove: () => setF((s) => ({ ...s, type: null })) }] : []),
    ...(f.upcoming ? [{ key: "status", label: "Upcoming", remove: () => setF((s) => ({ ...s, upcoming: null })) }] : f.pending !== null ? [{ key: "status", label: f.pending ? "Pending" : "Completed", remove: () => setF((s) => ({ ...s, pending: null })) }] : []),
    ...(custom ? [{ key: "range", label: rangeLabel(f.from, f.to), remove: () => range(null, null) }] : []),
    ...(f.recurring !== null ? [{ key: "recurring", label: f.recurring ? "Recurring" : "One-off", remove: () => setF((s) => ({ ...s, recurring: null })) }] : []),
    ...f.accounts.map((id) => ({ key: `a${id}`, label: names.accounts.get(id) ?? "Account", remove: () => setF((s) => ({ ...s, accounts: s.accounts.filter((x) => x !== id) })) })),
    ...f.categories.map((id) => ({ key: `c${id}`, label: id === "none" ? "Uncategorized" : names.categories.get(id) ?? "Category", remove: () => setF((s) => ({ ...s, categories: s.categories.filter((x) => x !== id) })) })),
    ...f.tags.map((id) => ({ key: `t${id}`, label: `#${names.tags.get(id) ?? "tag"}`, remove: () => setF((s) => ({ ...s, tags: s.tags.filter((x) => x !== id) })) })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title="Filters" left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Clear", bold: false, onPress: () => setF(EMPTY_FILTER) }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {active.length ? (
          <View style={styles.active}>
            <ChipRow>{active.map((a) => <Chip key={a.key} icon="xmark" label={a.label} active compact onPress={a.remove} />)}</ChipRow>
          </View>
        ) : null}
        <SectionHeader>Type</SectionHeader>
        <View style={styles.pad}>
          <Segmented<TxType | "all"> value={f.type ?? "all"} onChange={(v) => setF((s) => ({ ...s, type: v === "all" ? null : v }))}
            options={[{ value: "all", label: "All" }, { value: "expense", label: "Expenses" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfers" }]} />
        </View>
        <SectionHeader>Status</SectionHeader>
        <View style={styles.pad}>
          <Segmented<"any" | "done" | "pending" | "upcoming"> value={f.upcoming ? "upcoming" : f.pending === null ? "any" : f.pending ? "pending" : "done"}
            onChange={(v) => setF((s) => ({ ...s, upcoming: v === "upcoming" ? true : null, pending: v === "done" ? false : v === "pending" ? true : null }))}
            options={[{ value: "any", label: "Any" }, { value: "done", label: "Completed" }, { value: "pending", label: "Pending" }, { value: "upcoming", label: "Upcoming" }]} />
        </View>
        <SectionHeader>Source</SectionHeader>
        <View style={styles.pad}>
          <Segmented<"any" | "recurring" | "oneoff"> value={f.recurring === null ? "any" : f.recurring ? "recurring" : "oneoff"}
            onChange={(v) => setF((s) => ({ ...s, recurring: v === "any" ? null : v === "recurring" }))}
            options={[{ value: "any", label: "Any" }, { value: "recurring", label: "Recurring" }, { value: "oneoff", label: "One-off" }]} />
        </View>
        <Text style={styles.hint}>Recurring rows are the ones a rule posted, automatically or after you confirmed them.</Text>
        <SectionHeader>Period</SectionHeader>
        <Card style={{ paddingVertical: S.md, gap: S.sm }}>
          <ChipRow>
            <Chip label="Selected month" active={is(null, null)} onPress={() => range(null, null)} />
            {cur.subtitle ? <Chip label={`This period (${cur.subtitle})`} active={is(cur.start, cur.end)} onPress={() => range(cur.start, cur.end)} /> : null}
            {prev.subtitle ? <Chip label={`Last period (${prev.subtitle})`} active={is(prev.start, prev.end)} onPress={() => range(prev.start, prev.end)} /> : null}
            <Chip label="This month" active={is(month.start, month.end)} onPress={() => range(month.start, month.end)} />
            <Chip label="Last month" active={is(lastMonth.start, lastMonth.end)} onPress={() => range(lastMonth.start, lastMonth.end)} />
            <Chip label="This year" active={is(year, null)} onPress={() => range(year, null)} />
            <Chip label="All time" active={is(ALL_TIME, null)} onPress={() => range(ALL_TIME, null)} />
          </ChipRow>
          <ChipRow>
            <Chip icon="calendar" label={f.from && f.from !== ALL_TIME ? `From ${humanDayTime(f.from)}` : "From…"} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.from, selected: f.from && f.from !== ALL_TIME ? f.from : todayLocal() } })} />
            <Chip icon="calendar" label={f.to ? `To ${humanDayTime(prevDay(f.to))}` : "To…"} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.to, selected: f.to ? prevDay(f.to) : todayLocal() } })} />
          </ChipRow>
        </Card>
        <SectionHeader>Where</SectionHeader>
        <Card>
          <Row icon="creditcard" title="Accounts" subtitle={list(f.accounts, names.accounts, "Any account", "Account")} onPress={() => router.push({ pathname: "/pick/accounts", params: { key: keys.acc, selected: f.accounts.join(",") } })} />
          <Row icon="folder" iconColor="#FF9F0A" title="Categories" subtitle={list(f.categories, names.categories, "Any category", "Category")} onPress={() => router.push({ pathname: "/pick/categories", params: { key: keys.cat, selected: f.categories.join(",") } })} style={styles.divider} />
          <Row icon="number" iconColor="#5E5CE6" title="Tags" subtitle={list(f.tags, names.tags, "Any tag", "tag")} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tag, selected: f.tags.join(",") } })} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>A folder includes all its categories. Several accounts, categories or tags are combined with "or".</Text>
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <BigButton label="Show transactions" onPress={apply} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: S.lg },
  active: { paddingTop: S.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, paddingTop: S.sm },
  bottom: { paddingTop: S.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, backgroundColor: C.bgGrouped },
});
