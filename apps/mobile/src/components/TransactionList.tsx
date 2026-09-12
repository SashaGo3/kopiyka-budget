import { memo, useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { jsonIds, type Transaction } from "@kopiyka/core";
import { useQuery } from "@/store";
import { AmountPill, CategoryIcon, Empty, Money, TagPill } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { dayLabel, humanDayTime, timeLabel } from "@/lib/dates";

interface TagRef { id: string; name: string; color: string | null }

export interface TxRow extends Transaction { currency: string; account_name: string; category_name: string | null; parent_name: string | null; cat_icon: string | null; cat_color: string | null; parent_icon: string | null; parent_color: string | null; source: string | null }

export function useTransactions(where: string, params: (string | number)[] = [], limit = 500) {
  return useQuery((db) => db.all(
    `SELECT t.*, a.currency, a.name AS account_name, c.name AS category_name, p.name AS parent_name, c.icon AS cat_icon, c.color AS cat_color, p.icon AS parent_icon, p.color AS parent_color
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id
     WHERE t.deleted=0 AND ${where} ORDER BY t.date DESC, t.rowid DESC LIMIT ${limit}`, params) as unknown as TxRow[], [where, ...params]);
}

export function groupByDay(rows: TxRow[]) {
  const map = new Map<string, TxRow[]>();
  for (const r of rows) { const d = r.date.slice(0, 10); (map.get(d) ?? map.set(d, []).get(d)!).push(r); }
  return [...map].map(([day, data]) => ({ title: dayLabel(day), day, data, total: data.filter((t) => !t.transfer_id).reduce((a, t) => a + t.amount_minor, 0), currency: data[0]?.currency ?? "" }));
}

/** Highest income first, then the largest expenses; transfers last. Used by the "by amount" sort. */
export function sortByAmount(rows: TxRow[]): TxRow[] {
  const rank = (t: TxRow) => (t.transfer_id ? 2 : t.amount_minor >= 0 ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? b.amount_minor - a.amount_minor : Math.abs(b.amount_minor) - Math.abs(a.amount_minor)));
}

/**
 * Budget Flow style rows: note (or category) as title, account · category below, time and amount pill on the right.
 * Text wraps instead of being cut off, so the whole note and category path are readable in the list.
 * `flat` drops the day grouping (for amount sorting) and shows the day on each row instead.
 * `resetKey` remounts the list so it starts from the very top again (with the large title expanded).
 * With `selected` set the list is in selection mode: rows show a check circle and tapping toggles them.
 */
export function TransactionList({ rows, header, showAccount = true, resetKey, flat, onScroll, selected, onToggle }: {
  rows: TxRow[]; header?: React.ReactElement; showAccount?: boolean; resetKey?: string; flat?: boolean; onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  selected?: Set<string>; onToggle?: (id: string) => void;
}) {
  const sections = flat ? [{ title: "", day: "", data: rows, total: 0, currency: "" }] : groupByDay(rows);
  const selecting = !!selected;
  // Tags loaded once; resolved per row into a stable Map so the tags array a row gets doesn't
  // change reference (and TxItem doesn't re-render) unless that row's tags or the tags table did.
  const tagsById = useQuery((db) => new Map(db.all<{ id: string; name: string; color: string | null }>(
    `SELECT id, name, color FROM tags WHERE deleted=0`).map((r) => [r.id, { name: r.name, color: r.color }])));
  const tagsFor = useMemo(() => {
    const map = new Map<string, TagRef[]>();
    for (const t of rows) map.set(t.id, jsonIds(t.tag_ids).flatMap((id) => { const tag = tagsById.get(id); return tag ? [{ id, name: tag.name, color: tag.color }] : []; }));
    return map;
  }, [rows, tagsById]);
  return (
    <SectionList
      key={resetKey}
      sections={sections}
      keyExtractor={(t) => t.id}
      contentInsetAdjustmentBehavior="automatic"
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingBottom: 220 }}
      ListHeaderComponent={header}
      ListEmptyComponent={<Empty title="No transactions" hint="Tap Log to add one." />}
      stickySectionHeadersEnabled={false}
      // Fewer rows mounted off-screen: switching selection mode re-renders every mounted row.
      windowSize={7}
      initialNumToRender={14}
      maxToRenderPerBatch={14}
      renderSectionHeader={({ section }) => section.title ? <Text style={styles.sh}>{section.title}</Text> : <View style={{ height: S.sm }} />}
      renderSectionFooter={({ section }) => section.total !== 0 ? <Text style={styles.sum}>Sum: <Money minor={section.total} currency={section.currency} style={[styles.sumVal, { color: section.total < 0 ? C.red : C.green }]} /></Text> : <View style={{ height: S.sm }} />}
      renderItem={({ item: t, index, section }) => (
        <TxItem t={t} tags={tagsFor.get(t.id) ?? EMPTY_TAGS} flat={!!flat} showAccount={showAccount} first={index === 0} last={index === section.data.length - 1}
          selecting={selecting} on={selected?.has(t.id) ?? false} onToggle={onToggle} />
      )}
    />
  );
}

const EMPTY_TAGS: TagRef[] = [];

/** One row. Memoized: toggling one row in selection mode re-renders only that row. */
const TxItem = memo(function TxItem({ t, tags, flat, showAccount, first, last, selecting, on, onToggle }: {
  t: TxRow; tags: TagRef[]; flat: boolean; showAccount: boolean; first: boolean; last: boolean; selecting: boolean; on: boolean; onToggle?: (id: string) => void;
}) {
  const noteLines = t.notes ? t.notes.split("\n") : [];
  const note = noteLines[0] || null;
  const title = t.transfer_id ? (note ? `Transfer · ${note}` : "Transfer") : note || t.payee || t.category_name || t.parent_name || "Uncategorized";
  const restLines = note ? noteLines.slice(1, 3) : []; // at most 2 more lines of the note, under the title
  const category = t.category_name ? (t.parent_name ? `${t.parent_name} › ${t.category_name}` : t.category_name) : t.parent_name;
  const sub = [showAccount ? t.account_name : null, category].filter(Boolean).join(" · ");
  const payeeLine = t.payee && t.payee !== title ? t.payee : null;
  const crossCurrency = t.entered_currency && t.entered_currency !== t.currency && t.entered_amount_minor != null
    ? `entered ${(Math.abs(t.entered_amount_minor) / 100).toFixed(2)} ${t.entered_currency}${t.exchange_rate ? ` @ ${t.exchange_rate.toFixed(2)}` : ""}` : null;
  const a11yBits = [sub, tags.length ? `tags ${tags.map((x) => x.name).join(", ")}` : null, t.pending ? "pending" : null].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={() => selecting ? onToggle?.(t.id) : router.push(t.transfer_id ? { pathname: "/transfer/[id]", params: { id: t.transfer_id } } : { pathname: "/transaction/[id]", params: { id: t.id } })}
      style={({ pressed }) => [styles.item, first && styles.first, last && styles.last, !first && styles.divider, !!t.pending && styles.pendingBg, (pressed || on) && { backgroundColor: C.fill }]}
      accessibilityRole={selecting ? "checkbox" : "button"} accessibilityState={selecting ? { checked: on } : undefined} accessibilityLabel={`${title}, ${t.amount_minor / 100} ${t.currency}, ${a11yBits}`}>
      {t.pending ? <View style={styles.pendingBar} /> : null}
      {selecting ? <SymbolView name={on ? "checkmark.circle.fill" : "circle"} size={22} tintColor={on ? C.tint : C.tertiary} /> : null}
      {t.transfer_id ? <View style={styles.transferIcon}><SymbolView name="arrow.left.arrow.right" size={15} tintColor={C.secondary} /></View>
        : <CategoryIcon name={t.category_name ?? t.parent_name ?? "?"} icon={t.cat_icon ?? t.parent_icon} color={t.cat_color ?? t.parent_color} size={34} />}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {restLines.length ? <Text style={styles.sub} numberOfLines={2}>{restLines.join("\n")}</Text> : null}
        <Text style={styles.sub}>{sub}</Text>
        {tags.length ? <View style={styles.tagRow}>{tags.map((tag) => <TagPill key={tag.id} name={tag.name} color={tag.color} />)}</View> : null}
        {payeeLine ? <Text style={styles.sub}>{payeeLine}</Text> : null}
        {crossCurrency ? <Text style={styles.sub}>{crossCurrency}</Text> : null}
        {t.place || t.lat != null ? <Text style={styles.sub}>📍 {t.place ?? `${t.lat!.toFixed(4)}, ${t.lon!.toFixed(4)}`}</Text> : null}
      </View>
      <View style={styles.right}>
        <View style={styles.metaRow}>
          {t.recurring_id ? <SymbolView name="repeat" size={12} tintColor={C.secondary} /> : null}
          {t.photo ? <SymbolView name="camera" size={12} tintColor={C.secondary} /> : null}
          {t.pending ? <View style={styles.pendingRow}><SymbolView name="clock" size={12} tintColor={C.orange} /><Text style={styles.pendingText}>Pending</Text></View> : null}
          <Text style={styles.time}>{flat ? humanDayTime(t.date.slice(0, 10)) : timeLabel(t.date)}</Text>
        </View>
        <AmountPill minor={t.amount_minor} currency={t.currency} neutral={!!t.transfer_id} />
      </View>
      {selecting ? null : <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  sh: { fontSize: 20, fontWeight: "700", color: C.label, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.sm },
  sum: { color: C.secondary, fontSize: 14, paddingHorizontal: S.xl, paddingTop: 6, paddingBottom: S.sm },
  sumVal: { fontSize: 14, fontWeight: "600" },
  item: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, paddingHorizontal: S.md, paddingVertical: 10, backgroundColor: C.card, position: "relative", overflow: "hidden" },
  first: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  last: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  pendingBg: { backgroundColor: "rgba(255,149,0,0.10)" },
  pendingBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: C.orange },
  text: { flex: 1, minWidth: 0, gap: 2 },
  transferIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  right: { alignItems: "flex-end", gap: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  pendingText: { fontSize: 12, fontWeight: "600", color: C.orange },
  time: { fontSize: 13, color: C.secondary },
});
