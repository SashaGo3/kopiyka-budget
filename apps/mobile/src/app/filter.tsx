import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { listRows, listTrips } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { BigButton, Card, Chip, ChipRow, ModalHeader, Row, SectionHeader, Segmented } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { ALL_TIME, EMPTY_FILTER, prevDay, rangeLabel, type TxFilter, type TxType } from "@/lib/filters";
import { currentPeriod, shiftPeriod } from "@/lib/period";
import { humanDayTime, monthBounds, shiftMonth, todayLocal } from "@/lib/dates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/i18n";
import { catName, acctName } from "@/lib/names";

/** Type and status first, then the period, then accounts / categories / tags chosen in their own sheets. */
export default function FilterScreen() {
  const { key, value } = useLocalSearchParams<{ key: string; value?: string }>();
  const [f, setF] = useState<TxFilter>(() => { try { return { ...EMPTY_FILTER, ...(value ? JSON.parse(value) : {}) }; } catch { return EMPTY_FILTER; } });
  const insets = useSafeAreaInsets();
  const names = useQuery((db) => ({
    accounts: new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, acctName(a)])),
    categories: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, catName(c)])),
    tags: new Map(listRows(db, "tags", "1=1").map((x) => [x.id, x.name])),
  }));
  const trips = useQuery((db) => listTrips(db));
  const tripTags = new Set(trips.map((x) => x.tag_id));
  const trip = trips.find((x) => f.tags.includes(x.tag_id ?? ""));
  const keys = useMemo(() => ({ from: newPickKey("ffrom"), to: newPickKey("fto"), acc: newPickKey("facc"), cat: newPickKey("fcat"), tag: newPickKey("ftag"), trip: newPickKey("ftrip") }), []);
  // A travel is its tag, over the whole of it: the trip's days are rarely one month, and the flights
  // were bought weeks before, so choosing one opens the range to all time unless one was set by hand.
  usePickResult<string>(keys.trip, (tag: string) => setF((s) => ({
    ...s, tags: [...s.tags.filter((x) => !tripTags.has(x)), ...(tag === "any" ? [] : [tag])],
    ...(tag !== "any" && !s.from && !s.to ? { from: ALL_TIME } : {}),
  })));
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
  const list = (ids: string[], map: Map<string, string>, none: string, fallback: string) => ids.length ? ids.map((id) => (id === "none" ? t("common.noCategory") : map.get(id) ?? fallback)).join(", ") : none;
  const custom = !!(f.from || f.to);
  const active: { key: string; label: string; remove: () => void }[] = [
    ...(f.type ? [{ key: "type", label: typeLabel(f.type), remove: () => setF((s) => ({ ...s, type: null })) }] : []),
    ...(f.upcoming ? [{ key: "status", label: t("transactions.filter.upcoming"), remove: () => setF((s) => ({ ...s, upcoming: null })) }] : f.pending !== null ? [{ key: "status", label: f.pending ? t("transactions.filter.pending") : t("transactions.filter.completed"), remove: () => setF((s) => ({ ...s, pending: null })) }] : []),
    ...(custom ? [{ key: "range", label: rangeLabel(f.from, f.to), remove: () => range(null, null) }] : []),
    ...(f.recurring !== null ? [{ key: "recurring", label: f.recurring ? t("transactions.filter.recurring") : t("transactions.filter.oneOff"), remove: () => setF((s) => ({ ...s, recurring: null })) }] : []),
    ...f.accounts.map((id) => ({ key: `a${id}`, label: names.accounts.get(id) ?? t("transactions.filter.account"), remove: () => setF((s) => ({ ...s, accounts: s.accounts.filter((x) => x !== id) })) })),
    ...f.categories.map((id) => ({ key: `c${id}`, label: id === "none" ? t("common.noCategory") : names.categories.get(id) ?? t("transactions.filter.category"), remove: () => setF((s) => ({ ...s, categories: s.categories.filter((x) => x !== id) })) })),
    ...f.tags.map((id) => ({ key: `t${id}`, label: `#${names.tags.get(id) ?? t("transactions.filter.tag")}`, remove: () => setF((s) => ({ ...s, tags: s.tags.filter((x) => x !== id) })) })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("transactions.filter.title")} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("transactions.filter.clear"), bold: false, onPress: () => setF(EMPTY_FILTER) }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {active.length ? (
          <View style={styles.active}>
            <ChipRow>{active.map((a) => <Chip key={a.key} icon="xmark" label={a.label} active compact onPress={a.remove} />)}</ChipRow>
          </View>
        ) : null}
        <SectionHeader>{t("transactions.filter.type")}</SectionHeader>
        <View style={styles.pad}>
          <Segmented<TxType | "all"> value={f.type ?? "all"} onChange={(v) => setF((s) => ({ ...s, type: v === "all" ? null : v }))}
            options={[{ value: "all", label: t("transactions.filter.all") }, { value: "expense", label: typeLabel("expense") }, { value: "income", label: typeLabel("income") }, { value: "transfer", label: typeLabel("transfer") }]} />
        </View>
        <SectionHeader>{t("transactions.filter.status")}</SectionHeader>
        <View style={styles.pad}>
          <Segmented<"any" | "done" | "pending" | "upcoming"> value={f.upcoming ? "upcoming" : f.pending === null ? "any" : f.pending ? "pending" : "done"}
            onChange={(v) => setF((s) => ({ ...s, upcoming: v === "upcoming" ? true : null, pending: v === "done" ? false : v === "pending" ? true : null }))}
            options={[{ value: "any", label: t("transactions.filter.any") }, { value: "done", label: t("transactions.filter.completed") }, { value: "pending", label: t("transactions.filter.pending") }, { value: "upcoming", label: t("transactions.filter.upcoming") }]} />
        </View>
        <SectionHeader>{t("transactions.filter.source")}</SectionHeader>
        <View style={styles.pad}>
          <Segmented<"any" | "recurring" | "oneoff"> value={f.recurring === null ? "any" : f.recurring ? "recurring" : "oneoff"}
            onChange={(v) => setF((s) => ({ ...s, recurring: v === "any" ? null : v === "recurring" }))}
            options={[{ value: "any", label: t("transactions.filter.any") }, { value: "recurring", label: t("transactions.filter.recurring") }, { value: "oneoff", label: t("transactions.filter.oneOff") }]} />
        </View>
        <Text style={styles.hint}>{t("transactions.filter.recurringHint")}</Text>
        <SectionHeader>{t("transactions.filter.period")}</SectionHeader>
        <Card style={{ paddingVertical: S.md, gap: S.sm }}>
          <ChipRow>
            <Chip label={t("transactions.filter.selectedMonth")} active={is(null, null)} onPress={() => range(null, null)} />
            {cur.subtitle ? <Chip label={t("transactions.filter.thisPeriod", { range: cur.subtitle })} active={is(cur.start, cur.end)} onPress={() => range(cur.start, cur.end)} /> : null}
            {prev.subtitle ? <Chip label={t("transactions.filter.lastPeriod", { range: prev.subtitle })} active={is(prev.start, prev.end)} onPress={() => range(prev.start, prev.end)} /> : null}
            <Chip label={t("transactions.filter.thisMonth")} active={is(month.start, month.end)} onPress={() => range(month.start, month.end)} />
            <Chip label={t("transactions.filter.lastMonth")} active={is(lastMonth.start, lastMonth.end)} onPress={() => range(lastMonth.start, lastMonth.end)} />
            <Chip label={t("transactions.filter.thisYear")} active={is(year, null)} onPress={() => range(year, null)} />
            <Chip label={t("transactions.range.allTime")} active={is(ALL_TIME, null)} onPress={() => range(ALL_TIME, null)} />
          </ChipRow>
          <ChipRow>
            <Chip icon="calendar" label={f.from && f.from !== ALL_TIME ? t("transactions.filter.from", { day: humanDayTime(f.from) }) : t("transactions.filter.fromEmpty")} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.from, selected: f.from && f.from !== ALL_TIME ? f.from : todayLocal() } })} />
            <Chip icon="calendar" label={f.to ? t("transactions.filter.to", { day: humanDayTime(prevDay(f.to)) }) : t("transactions.filter.toEmpty")} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.to, selected: f.to ? prevDay(f.to) : todayLocal() } })} />
          </ChipRow>
        </Card>
        <SectionHeader>{t("transactions.filter.where")}</SectionHeader>
        <Card>
          <Row icon="creditcard" title={t("transactions.filter.accounts")} subtitle={list(f.accounts, names.accounts, t("transactions.filter.anyAccount"), t("transactions.filter.account"))} onPress={() => router.push({ pathname: "/pick/accounts", params: { key: keys.acc, selected: f.accounts.join(",") } })} />
          <Row icon="folder" iconColor="#FF9F0A" title={t("transactions.filter.categories")} subtitle={list(f.categories, names.categories, t("transactions.filter.anyCategory"), t("transactions.filter.category"))} onPress={() => router.push({ pathname: "/pick/categories", params: { key: keys.cat, selected: f.categories.join(",") } })} style={styles.divider} />
          <Row icon="number" iconColor="#5E5CE6" title={t("transactions.filter.tags")} subtitle={list(f.tags, names.tags, t("transactions.filter.anyTag"), t("transactions.filter.tag"))} onPress={() => router.push({ pathname: "/pick/tags", params: { key: keys.tag, selected: f.tags.join(",") } })} style={styles.divider} />
          {trips.length ? (
            <Row icon="airplane" iconColor="#0A84FF" title={t("transactions.filter.travel")} subtitle={trip ? names.tags.get(trip.tag_id ?? "") ?? t("transactions.filter.travel") : t("transactions.filter.anyTravel")} style={styles.divider}
              onPress={() => router.push({ pathname: "/pick/option", params: { key: keys.trip, title: t("transactions.filter.travel"), selected: trip?.tag_id ?? "any", options: JSON.stringify([
                { value: "any", label: t("transactions.filter.anyTravel") },
                ...trips.map((x) => {
                  const span = { from: humanDayTime(x.starts, null, undefined, true), to: humanDayTime(x.ended ?? x.ends ?? x.starts, null, undefined, true) };
                  return { value: x.tag_id, label: names.tags.get(x.tag_id ?? "") ?? t("transactions.filter.travel"), subtitle: x.ended ? t("transactions.filter.tripRange", span) : t("transactions.filter.tripRangeNow", span) };
                }),
              ]) } })} />
          ) : null}
        </Card>
        <Text style={styles.hint}>{t("transactions.filter.hint")}</Text>
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <BigButton label={t("transactions.filter.show")} onPress={apply} />
      </View>
    </View>
  );
}

function typeLabel(type: TxType): string {
  return type === "expense" ? t("transactions.filter.expenses") : type === "income" ? t("transactions.filter.income") : t("transactions.filter.transfers");
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: S.lg },
  active: { paddingTop: S.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, paddingTop: S.sm },
  bottom: { paddingTop: S.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, backgroundColor: C.bgGrouped },
});
