import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { formatMinor, jsonIds, numberFormat, paidAmountMinor, type Transaction } from "@kopiyka/core";
import { useQuery } from "@/store";
import { useCloudRefresh } from "@/lib/backup";
import { AmountPill, CategoryIcon, Empty, Money, TagPill } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { dayLabel, humanDayTime, timeLabel } from "@/lib/dates";
import { t } from "@/i18n";
import { catName, acctName } from "@/lib/names";

interface TagRef { id: string; name: string; color: string | null }

export interface TxRow extends Transaction { currency: string; account_name: string; category_name: string | null; parent_name: string | null; cat_preset: string | null; parent_preset: string | null; cat_icon: string | null; cat_color: string | null; parent_icon: string | null; parent_color: string | null; source: string | null;
  /** Who the debt this row pays is with (`debt_id`); null when it is not a debt payment. */
  debt_person: string | null }

export function useTransactions(where: string, params: (string | number)[] = [], limit = 500) {
  return useQuery((db) => db.all(
    `SELECT t.*, a.currency, a.name AS account_name, c.name AS category_name, p.name AS parent_name, c.preset AS cat_preset, p.preset AS parent_preset, c.icon AS cat_icon, c.color AS cat_color, p.icon AS parent_icon, p.color AS parent_color, d.person AS debt_person
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id LEFT JOIN debts d ON d.id=t.debt_id
     WHERE t.deleted=0 AND ${where} ORDER BY t.date DESC, t.rowid DESC LIMIT ${limit}`, params) as unknown as TxRow[], [where, ...params]);
}

/**
 * The row's category and its folder as the app shows them: a ready-made category in the app's
 * language until it is renamed (DATA.md rule 16). `category_name` / `parent_name` stay the stored
 * names — what the icon guess and search read.
 */
export function rowCategory(tx: Pick<TxRow, "category_name" | "parent_name" | "cat_preset" | "parent_preset">): { name: string | null; parent: string | null } {
  return {
    name: tx.category_name ? catName({ name: tx.category_name, preset: tx.cat_preset }) : null,
    parent: tx.parent_name ? catName({ name: tx.parent_name, preset: tx.parent_preset }) : null,
  };
}

/** A decimal number in the language's separator, for rates (money goes through `formatMinor`). */
function decimalText(n: number, digits: number): string {
  return n.toFixed(digits).replace(".", numberFormat().decimal);
}

export function groupByDay(rows: TxRow[]) {
  const map = new Map<string, TxRow[]>();
  for (const r of rows) { const d = r.date.slice(0, 10); (map.get(d) ?? map.set(d, []).get(d)!).push(r); }
  return [...map].map(([day, data]) => ({ title: dayLabel(day), day, data, total: data.filter((r) => !r.transfer_id).reduce((a, r) => a + r.amount_minor, 0), currency: data[0]?.currency ?? "" }));
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
 * `onSelect` is how it is entered: touching and holding a row (there is no Select button), which
 * starts selection mode with that row chosen.
 */
export function TransactionList({ rows, header, empty, showAccount = true, resetKey, flat, onScroll, selected, onToggle, onSelect, keyboardDismissMode }: {
  rows: TxRow[]; header?: React.ReactElement; empty?: React.ReactElement; showAccount?: boolean; resetKey?: string; flat?: boolean; onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  selected?: Set<string>; onToggle?: (id: string) => void; onSelect?: (id: string) => void; keyboardDismissMode?: "none" | "on-drag" | "interactive";
}) {
  const sections = useMemo(() => flat ? [{ title: "", day: "", data: rows, total: 0, currency: "" }] : groupByDay(rows), [rows, flat]);
  const selecting = !!selected;
  // Switching selection mode re-renders no row: the check circle and the chevron slide on the UI
  // thread from one shared value, and a tap asks `mode.on` what it means. Only the accessibility
  // role follows, in a deferred render once the slide is under way.
  const progress = useSharedValue(selecting ? 1 : 0);
  const on = useRef(selecting);
  const mode = useMemo<SelectMode>(() => ({ progress, on }), [progress]);
  useLayoutEffect(() => { on.current = selecting; }, [selecting]);
  useEffect(() => { progress.value = withTiming(selecting ? 1 : 0, { duration: 240 }); }, [selecting, progress]);
  const a11ySelecting = useDeferredValue(selecting);
  const top = useRef<View>(null);
  const { listRef, onListScroll, holdHandlers } = useHeldScroll(selecting, resetKey, top, onScroll);
  // Pull to refresh: re-read the database (a Shortcut automation or the watch writes into it while
  // the app is in the background, and nothing tells JS about that) and look in iCloud for what
  // another device has backed up. Budgets pulls on the same hook, so the gesture means one thing.
  const { refreshing, onRefresh } = useCloudRefresh();
  // Tags loaded once; resolved per row into a stable Map so the tags array a row gets doesn't
  // change reference (and TxItem doesn't re-render) unless that row's tags or the tags table did.
  const tagsById = useQuery((db) => new Map(db.all<{ id: string; name: string; color: string | null }>(
    `SELECT id, name, color FROM tags WHERE deleted=0`).map((r) => [r.id, { name: r.name, color: r.color }])));
  const tagsFor = useMemo(() => {
    const map = new Map<string, TagRef[]>();
    for (const tx of rows) map.set(tx.id, jsonIds(tx.tag_ids).flatMap((id) => { const tag = tagsById.get(id); return tag ? [{ id, name: tag.name, color: tag.color }] : []; }));
    return map;
  }, [rows, tagsById]);
  return (
    <SectionList
      key={resetKey}
      ref={listRef}
      sections={sections}
      keyExtractor={(tx) => tx.id}
      contentInsetAdjustmentBehavior="automatic"
      onScroll={onListScroll}
      scrollEventThrottle={16}
      keyboardDismissMode={keyboardDismissMode}
      keyboardShouldPersistTaps="handled"
      {...holdHandlers}
      // A row written while the list is open — a Shortcut's payment, the watch, another device's
      // merge — lands above whatever is on screen, and iOS kept the offset, so everything under the
      // finger slid down a row for every write the automation made. The first thing visible (the
      // header while the list rests at the top, otherwise a row) stays where it is instead.
      maintainVisibleContentPosition={MAINTAIN_POSITION}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={{ paddingBottom: 220 }}
      // `top` marks the content's first point, so the list can tell where it rests before it has ever scrolled.
      ListHeaderComponent={<><View ref={top} collapsable={false} />{header}</>}
      // The caller knows what it filtered by, so it can say why there is nothing here.
      ListEmptyComponent={empty ?? <Empty title={t("transactions.empty.title")} hint={t("transactions.list.emptyHint")} />}
      stickySectionHeadersEnabled={false}
      // Fewer rows mounted off-screen: switching selection mode re-renders every mounted row.
      windowSize={7}
      initialNumToRender={14}
      maxToRenderPerBatch={14}
      renderSectionHeader={({ section }) => section.title ? <Text style={styles.sh}>{section.title}</Text> : <View style={{ height: S.sm }} />}
      renderSectionFooter={({ section }) => section.total !== 0 ? <Text style={styles.sum}>{t("transactions.list.sum")} <Money minor={section.total} currency={section.currency} style={[styles.sumVal, { color: section.total < 0 ? C.red : C.green }]} /></Text> : <View style={{ height: S.sm }} />}
      renderItem={({ item: tx, index, section }) => (
        <TxItem tx={tx} tags={tagsFor.get(tx.id) ?? EMPTY_TAGS} flat={!!flat} showAccount={showAccount} first={index === 0} last={index === section.data.length - 1}
          mode={mode} a11ySelecting={a11ySelecting} on={selected?.has(tx.id) ?? false} onToggle={onToggle} onSelect={onSelect} />
      )}
    />
  );
}

const EMPTY_TAGS: TagRef[] = [];
const MAINTAIN_POSITION = { minIndexForVisible: 0 };

/**
 * Every write re-reads the list, and every row comes back as a new object even when nothing in it
 * changed, so the default memo re-rendered every mounted row on every write. A row's fields are all
 * plain values, and its tags a short list: compared one by one, only the rows that actually changed
 * render again.
 */
function sameItem(a: Parameters<typeof TxItemView>[0], b: Parameters<typeof TxItemView>[0]): boolean {
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    if (k === "tx") continue;
    if (k === "tags") {
      if (a.tags.length !== b.tags.length || a.tags.some((x, i) => x.id !== b.tags[i]!.id || x.name !== b.tags[i]!.name || x.color !== b.tags[i]!.color)) return false;
      continue;
    }
    if (a[k] !== b[k]) return false;
  }
  if (a.tx === b.tx) return true;
  const ka = Object.keys(a.tx) as (keyof TxRow)[];
  if (ka.length !== Object.keys(b.tx).length) return false;
  return ka.every((k) => a.tx[k] === b.tx[k]);
}

/** Selection mode as the rows see it: a stable object, so entering or leaving it changes no row's props. */
interface SelectMode { progress: SharedValue<number>; on: RefObject<boolean> }

/**
 * What selection mode adds and takes away, by fading only: the check circle comes in over the
 * category icon and the chevron fades out where it stands. Nothing changes width. A check slot that
 * slid in on the left used to narrow every row's text, a long note or category path then wrapped onto
 * one more line in rows above the screen, and the whole list moved under the finger — the jump that
 * selecting caused however the scroll offset was held.
 */
function useSelectStyles(progress: SharedValue<number>) {
  const check = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: interpolate(progress.value, [0, 1], [0.6, 1]) }] }));
  const icon = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const chevron = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  return { check, icon, chevron };
}

type Section = ReturnType<typeof groupByDay>[number];

/** How long after entering or leaving selection mode the list puts itself back if something moves it. */
const HOLD_MS = 600;

/**
 * Keeps the list where it was when selection mode switches. Tapping Select changes the header (its
 * title, a Select all button) and the rows (a check circle each), and iOS answered that by moving
 * the list to the top: the rows under the finger were gone. Whatever moves it, the offset from
 * just before the switch is put back on every scroll or size change for a moment after, unless
 * the finger is on the list by then.
 * `list` is the list's own key: a remount starts a new list at the top, and the offset the old one
 * last reported is forgotten with it. Kept, it was "put back" on the next touch and hold, before the
 * new list had scrolled at all — the list ran down to where the old one had been.
 */
function useHeldScroll(key: boolean, list: string | undefined, top: RefObject<View | null>, onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void) {
  const listRef = useRef<SectionList<TxRow, Section>>(null);
  // Unknown until the list reports a scroll. iOS rests a list under a large title at a negative offset
  // and says nothing about it, so a 0 assumed here was "put back" by scrolling the title away and the
  // first rows up under the bar — the jump down to the list that Select used to make.
  const y = useRef<number | null>(null);
  /**
   * Where a list that has not scrolled yet is resting, from the layout: how far the content's first
   * point sits below the list's own top. Without it a hold in the very first position had nothing to
   * hold, and a row held under the expanded title slid the whole list away under the finger. Both
   * measurements are synchronous on the new architecture; if either is not, nothing is held, as before.
   */
  const resting = () => {
    let at: number | null = null;
    listRef.current?.getScrollResponder()?.getNativeScrollRef()?.measureInWindow((_x, listY) => {
      top.current?.measureInWindow((_x2, contentY) => { at = listY - contentY; });
    });
    return at;
  };
  const hold = useRef<{ y: number; until: number } | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => { y.current = null; hold.current = null; }, [list]);
  const restore = useCallback(() => {
    const h = hold.current;
    if (!h) return;
    if (Date.now() > h.until) { hold.current = null; return; }
    listRef.current?.getScrollResponder()?.scrollTo({ y: h.y, animated: false });
  }, []);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const at = y.current ?? resting();
    if (at === null) return;
    hold.current = { y: at, until: Date.now() + HOLD_MS };
    const frame = requestAnimationFrame(restore);
    const late = setTimeout(restore, 120);
    return () => { cancelAnimationFrame(frame); clearTimeout(late); };
  }, [key, restore]);
  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const now = e.nativeEvent.contentOffset.y;
    const h = hold.current;
    if (h && Date.now() <= h.until && Math.abs(now - h.y) > 1) { restore(); return; }
    y.current = now;
    onScroll?.(e);
  }, [onScroll, restore]);
  return {
    listRef,
    onListScroll,
    holdHandlers: { onScrollBeginDrag: () => { hold.current = null; }, onContentSizeChange: restore },
  };
}

/** One row. Memoized: toggling one row in selection mode re-renders only that row, and entering or leaving it none. */
const TxItem = memo(TxItemView, sameItem);

function TxItemView({ tx, tags, flat, showAccount, first, last, mode, a11ySelecting, on, onToggle, onSelect }: {
  tx: TxRow; tags: TagRef[]; flat: boolean; showAccount: boolean; first: boolean; last: boolean; mode: SelectMode; a11ySelecting: boolean; on: boolean; onToggle?: (id: string) => void; onSelect?: (id: string) => void;
}) {
  const slide = useSelectStyles(mode.progress);
  // Your note, and what the bank's notification said (`bank_note`, v23): two texts, never one.
  // An older entry may hold the payee in its note (the entry sheet used to seed it), which says nothing twice.
  const note = tx.notes?.trim() && tx.notes.trim() !== tx.payee ? tx.notes.trim() : null;
  const bank = tx.bank_note?.trim() || null;
  const names = rowCategory(tx);
  // A debt payment has no category: what it pays is the debt, and it says whose.
  const debtLabel = tx.debt_id ? t("transactions.list.debt", { person: tx.debt_person ?? "?" }) : null;
  // The shop names the row; without one, your note does, and without that the bank's words.
  const titled = tx.transfer_id ? note : tx.payee ? null : note ?? bank;
  const firstOf = (s: string | null) => s?.split("\n")[0] ?? "";
  const title = tx.transfer_id ? (note ? t("transactions.list.transferNote", { note: firstOf(note) }) : t("transactions.list.transfer")) : tx.payee || firstOf(titled) || names.name || names.parent || debtLabel || t("common.noCategory");
  // Under the title, at most two lines of each: whatever of it the title has not already said.
  const under = (s: string | null) => { if (!s) return null; const lines = s.split("\n"); return (s === titled ? lines.slice(1) : lines).slice(0, 2).join("\n") || null; };
  const noteSub = under(note), bankSub = under(bank);
  const category = names.name ? (names.parent ? `${names.parent} › ${names.name}` : names.name) : names.parent ?? debtLabel;
  const sub = [showAccount ? acctName({ name: tx.account_name }) : null, category].filter(Boolean).join(" · ");
  const payeeLine = tx.payee && tx.payee !== title ? tx.payee : null;
  const crossCurrency = tx.entered_currency && tx.entered_currency !== tx.currency && tx.entered_amount_minor != null
    ? (tx.exchange_rate
      ? t("transactions.list.enteredRate", { amount: formatMinor(Math.abs(tx.entered_amount_minor), tx.entered_currency), currency: tx.entered_currency, rate: decimalText(tx.exchange_rate, 2) })
      : t("transactions.list.entered", { amount: formatMinor(Math.abs(tx.entered_amount_minor), tx.entered_currency), currency: tx.entered_currency })) : null;
  // Part of this came back (packages/core/returns.ts): the row shows what it ended up costing, with
  // what was paid struck through next to it, so a shrunken amount is never a mystery.
  const returned = tx.refunded_minor ? t("transactions.list.returned", { paid: formatMinor(Math.abs(paidAmountMinor(tx)), tx.currency), back: formatMinor(Math.abs(tx.refunded_minor), tx.currency) }) : null;
  const a11yBits = [sub, tags.length ? t("transactions.list.tagsA11y", { names: tags.map((x) => x.name).join(", ") }) : null, tx.pending ? t("transactions.list.pendingA11y") : null].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={() => mode.on.current ? onToggle?.(tx.id) : router.push(tx.transfer_id ? { pathname: "/transfer/[id]", params: { id: tx.transfer_id } } : { pathname: "/transaction/[id]", params: { id: tx.id } })}
      // Touch and hold starts selecting, with this row chosen; while selecting it is a tap like any other.
      onLongPress={onSelect ? () => { if (mode.on.current) onToggle?.(tx.id); else { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSelect(tx.id); } } : undefined}
      delayLongPress={350}
      accessibilityActions={onSelect && !a11ySelecting ? [{ name: "select", label: t("transactions.select") }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "select") onSelect?.(tx.id); }}
      accessibilityHint={onSelect && !a11ySelecting ? t("transactions.list.selectHint") : undefined}
      style={({ pressed }) => [styles.item, first && styles.first, last && styles.last, !first && styles.divider, !!tx.pending && styles.pendingBg, (pressed || on) && { backgroundColor: C.fill }]}
      accessibilityRole={a11ySelecting ? "checkbox" : "button"} accessibilityState={a11ySelecting ? { checked: on } : undefined} accessibilityLabel={`${title}, ${formatMinor(tx.amount_minor, tx.currency)} ${tx.currency}, ${a11yBits}`}>
      {tx.pending ? <View style={styles.pendingBar} /> : null}
      <View style={styles.iconSlot}>
        <Animated.View style={slide.icon}>
          {tx.transfer_id ? <View style={styles.transferIcon}><SymbolView name="arrow.left.arrow.right" size={15} tintColor={C.secondary} /></View>
            : <CategoryIcon name={tx.category_name ?? tx.parent_name ?? "?"} icon={tx.cat_icon ?? tx.parent_icon ?? (tx.debt_id && !tx.category_id ? "creditcard.and.123" : null)} color={tx.cat_color ?? tx.parent_color} size={34} />}
        </Animated.View>
        <Animated.View style={[styles.check, slide.check]} pointerEvents="none" importantForAccessibility="no-hide-descendants"><SymbolView name={on ? "checkmark.circle.fill" : "circle"} size={26} tintColor={on ? C.tint : C.tertiary} /></Animated.View>
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {noteSub ? <Text style={styles.sub} numberOfLines={2}>{noteSub}</Text> : null}
        {bankSub ? <Text style={styles.sub} numberOfLines={2}>{bankSub}</Text> : null}
        <Text style={styles.sub}>{sub}</Text>
        {tags.length ? <View style={styles.tagRow}>{tags.map((tag) => <TagPill key={tag.id} name={tag.name} color={tag.color} />)}</View> : null}
        {payeeLine ? <Text style={styles.sub}>{payeeLine}</Text> : null}
        {crossCurrency ? <Text style={styles.sub}>{crossCurrency}</Text> : null}
        {returned ? <Text style={[styles.sub, { color: C.green as unknown as string }]}>↩ {returned}</Text> : null}
        {tx.place || tx.lat != null ? <Text style={styles.sub}>📍 {tx.place ?? `${tx.lat!.toFixed(4)}, ${tx.lon!.toFixed(4)}`}</Text> : null}
      </View>
      <View style={styles.right}>
        <View style={styles.metaRow}>
          {tx.recurring_id ? <SymbolView name="repeat" size={12} tintColor={C.secondary} /> : null}
          {tx.photo ? <SymbolView name="camera" size={12} tintColor={C.secondary} /> : null}
          {tx.pending ? <View style={styles.pendingRow}><SymbolView name="clock" size={12} tintColor={C.orange} /><Text style={styles.pendingText}>{t("transactions.list.pending")}</Text></View> : null}
          <Text style={styles.time}>{flat ? humanDayTime(tx.date.slice(0, 10)) : timeLabel(tx.date)}</Text>
        </View>
        <AmountPill minor={tx.amount_minor} currency={tx.currency} neutral={!!tx.transfer_id} />
      </View>
      <Animated.View style={[styles.slot, slide.chevron]} importantForAccessibility="no-hide-descendants"><SymbolView name="chevron.right" size={12} tintColor={C.tertiary} /></Animated.View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
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
  slot: { flexShrink: 0, width: 12, alignItems: "center" },
  // The category icon and, over it while selecting, the check circle: one fixed square either way.
  iconSlot: { width: 34, height: 34, flexShrink: 0 },
  check: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
}));
