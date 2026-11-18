import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { archivedCategoryIds, cachedRateFor, folderIds, formatMinor, fromMinor, listRows, payAccountFor, rateOrFallback, receiptPlan, toMinor } from "@kopiyka/core";
import { db } from "@/db";
import { Tap, accountIcon } from "@/components/ui";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { usePhotoReading } from "@/lib/photoText";
import { setReadSheetUp, useShownPhoto } from "@/lib/photoShown";
import { copyToClipboard } from "@/lib/device";
import { acctName, catName } from "@/lib/names";
import { itemsNote } from "@/lib/receiptFill";
import { dayChipLabel, todayLocal } from "@/lib/dates";
import { C, Fonts, R, S, Type, themed } from "@/constants/theme";
import { t } from "@/i18n";
import type { AmountPick } from "@/app/pick/amount";
import type { PhotoSplit } from "@/app/photo/view";

/** What a person changed about one item: anything left out is still what the receipt and the model said. */
type ItemEdit = { price?: number; category_id?: string | null; tag_ids?: string[]; note?: string | null };

/**
 * What a photo says, in a native form sheet over the photo (`photo/view` opens it). Three heights —
 * the shop, half the screen, nearly all of it — and the photo above stays zoomable at the first two.
 *
 * For a receipt the flow is: it is read (a spinner, nothing to do meanwhile), its items come up
 * already sorted into categories by the on-device model, any of them can be tapped to change its
 * price, category, tags or note — on the keypad sheet a split part is edited on — and Continue
 * hands it all to the entry sheet, which fills itself in and saves: one entry per category
 * (DATA.md rule 11). The day the receipt is for can be changed here too: the reader can misread it,
 * and a receipt photographed late is still the day's shopping.
 *
 * The whole sheet is one ScrollView with the shop pinned on top. A form sheet hoists any scroll view
 * it finds to the top of itself, so a list under a header was drawn over the header.
 */
export default function PhotoRead() {
  const p = useLocalSearchParams<{ uri: string; split?: string; total?: string; currency?: string; category?: string; date?: string; account?: string }>();
  const uri = useShownPhoto(p.uri);
  const reading = usePhotoReading(uri);
  const insets = useSafeAreaInsets();
  useEffect(() => { setReadSheetUp(true); return () => setReadSheetUp(false); }, []);

  const parse = reading.parse && reading.parse.total > 0 ? reading.parse : null;
  const items = useMemo(() => reading.parse?.items ?? [], [reading.parse]);
  // A receipt read with items opens on them; a photo of anything else shows its text.
  const [tabChoice, setTab] = useState<"text" | "items" | null>(null);
  const tab = tabChoice ?? (items.length ? "items" : "text");
  const busy = reading.status === "reading" || reading.status === "text" || reading.status === "items";

  // ---- Categories ---------------------------------------------------------------------------------
  const cats = useQuery((d) => listRows(d, "categories", "deleted=0"), []);
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  // Only what a transaction may be filed under: no folders, nothing archived (DATA.md rules 5, 14).
  const pickable = useMemo(() => {
    const folders = folderIds(cats), archived = archivedCategoryIds(cats);
    return new Set(cats.filter((c) => c.kind === "expense" && !folders.has(c.id) && !archived.has(c.id)).map((c) => c.id));
  }, [cats]);
  const tagRows = useQuery((d) => new Map(listRows(d, "tags", "deleted=0").map((x) => [x.id, x])), []);

  // ---- What was changed ---------------------------------------------------------------------------
  const [edits, setEdits] = useState<Map<number, ItemEdit>>(new Map());
  const [day, setDay] = useState<string | null>(null);
  // A new photo (Replace, on the photo) is read from the start: what was changed belonged to the old one.
  const [readFor, setReadFor] = useState(uri);
  if (readFor !== uri) { setReadFor(uri); setEdits(new Map()); setDay(null); setTab(null); }
  const edit = (indices: number[], change: ItemEdit) => setEdits((cur) => {
    const n = new Map(cur);
    for (const i of indices) n.set(i, { ...n.get(i), ...change });
    return n;
  });

  const price = (i: number) => edits.get(i)?.price ?? items[i]?.price ?? 0;
  const assigned = useMemo(() => items.map((_, i) => {
    const e = edits.get(i);
    if (e && "category_id" in e) return e.category_id ?? null;
    const id = reading.cats[i];
    return id && pickable.has(id) ? id : null;
  }), [items, edits, reading.cats, pickable]);

  // The items under the category each is in, in the order the categories first appear on the
  // receipt; what has no category comes last. One lot without a category has no header.
  const groups = useMemo(() => {
    const by = new Map<string | null, number[]>();
    items.forEach((_, i) => { const k = assigned[i] ?? null; by.set(k, [...(by.get(k) ?? []), i]); });
    const keys: (string | null)[] = [...by.keys()].filter((k) => k !== null);
    if (by.has(null)) keys.push(null);
    return keys.map((k) => {
      const indices = by.get(k)!;
      const c = k ? byId.get(k) : undefined;
      return {
        cat: k, indices, color: c?.color ?? "#8e8e93",
        header: keys.length === 1 && k === null ? null : c ? catName(c) : t("photo.read.uncategorized"),
        sum: indices.reduce((a, i) => a + (edits.get(i)?.price ?? items[i]?.price ?? 0), 0),
      };
    });
  }, [items, assigned, byId, edits]);

  const itemCurrency = parse?.currency ?? p.currency ?? "EUR";
  const money = (major: number) => formatMinor(toMinor(major, itemCurrency), itemCurrency);

  // ---- Paid from -----------------------------------------------------------------------------------
  // A receipt in another currency asks which account paid it: the one last used for that currency,
  // else one held in it (core payAccount.ts — read off the expenses, nothing stored), changeable here,
  // with what it comes to in that account's currency. Continue hands the choice to the entry sheet.
  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND archived=0", [], "sort"), []);
  const [payWith, setPayWith] = useState<string | null>(null);
  // In the entry's own currency the account it was opened on stays; only a foreign receipt is looked up.
  const suggestedPay = useMemo(() => (parse && itemCurrency !== p.currency ? payAccountFor(db, itemCurrency, p.account ?? null) : p.account ?? null), [parse, itemCurrency, p.currency, p.account]);
  const payId = payWith ?? suggestedPay;
  const payAccount = accounts.find((a) => a.id === payId) ?? null;
  const askAccount = !!parse && !!p.split && accounts.length > 1 && (itemCurrency !== p.currency || payId !== p.account);
  const payCurrency = payAccount?.currency ?? p.currency ?? itemCurrency;
  const cross = payCurrency !== itemCurrency;
  const [fetched, setFetched] = useState<number | null>(null);
  const cachedPayRate = cross ? cachedRateFor(db)(itemCurrency, payCurrency) : 1;
  useEffect(() => {
    if (!askAccount || !cross || cachedPayRate !== null) return;
    let alive = true;
    void rateOrFallback(db, itemCurrency, payCurrency).then((r) => { if (alive) setFetched(r?.rate ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [askAccount, cross, cachedPayRate, itemCurrency, payCurrency]);
  const payRate = cachedPayRate ?? fetched;
  const [payKey] = useState(() => newPickKey("receiptpay"));
  usePickResult<string>(payKey, (v: string) => setPayWith(v));
  const openPay = () => router.push({ pathname: "/pick/account", params: { key: payKey, ...(payId ? { selected: payId } : {}) } });

  // One item, on the keypad sheet a split part is edited on: price, category, tags, note.
  const editing = useRef<number[]>([]);
  const [itemKey] = useState(() => newPickKey("receiptitem"));
  usePickResult<AmountPick>(itemKey, (v: AmountPick) => {
    edit(editing.current, { price: fromMinor(v.minor, itemCurrency), category_id: v.category_id, tag_ids: v.tag_ids, note: v.note ?? null });
  });
  const openItem = (i: number) => {
    const it = items[i];
    if (!it) return;
    editing.current = [i];
    router.push({ pathname: "/pick/amount", params: {
      key: itemKey, title: it.name, currency: itemCurrency, value: String(toMinor(price(i), itemCurrency)), kind: "expense",
      category: assigned[i] ?? "", tags: (edits.get(i)?.tag_ids ?? []).join(","), note: edits.get(i)?.note ?? "",
    } });
  };
  // A whole group moves to another category in one go.
  const [groupKey] = useState(() => newPickKey("receiptgroup"));
  usePickResult<string | null>(groupKey, (v: string | null) => { if (!v?.startsWith("debt:")) edit(editing.current, { category_id: v }); });
  const openGroup = (cat: string | null, indices: number[]) => {
    editing.current = indices;
    router.push({ pathname: "/pick/category", params: { key: groupKey, kind: "expense", selected: cat ?? "" } });
  };

  // ---- The day ------------------------------------------------------------------------------------
  const readDay = parse?.date && /^\d{4}-\d{2}-\d{2}$/.test(parse.date) ? parse.date : null;
  const shownDay = day ?? readDay ?? p.date ?? todayLocal();
  const [dayKey] = useState(() => newPickKey("receiptday"));
  usePickResult<string>(dayKey, (v: string) => setDay(v));
  const openDay = () => router.push({ pathname: "/pick/date", params: { key: dayKey, selected: shownDay } });

  // ---- Continue -----------------------------------------------------------------------------------
  // What is being divided: the entry's amount, or — on an entry not filled in yet — the receipt's own
  // total when it is in the entry's currency (the entry sheet fills the same amount in).
  const entryTotal = Number(p.total) > 0 ? Number(p.total)
    : parse && p.currency && (!parse.currency || parse.currency === p.currency) ? toMinor(parse.total, p.currency) : 0;
  const canContinue = !!p.split && !!parse;
  const go = () => {
    if (!p.split || !parse) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const sorted = items.map((_, i) => ({ price: price(i), category_id: assigned[i] ?? null }));
    // How the items become a split is core's (receiptEntry.ts): against the entry's total, or a
    // nominal one the entry sheet scales once a converted amount is in.
    const plan = receiptPlan(sorted, parse.total, entryTotal, p.category || null);
    const inGroup = (cat: string | null) => items.map((_, i) => i).filter((i) => plan.rowOf[i] === cat);
    const noteOf = (cat: string | null) => itemsNote(inGroup(cat).map((i) => {
      const n = edits.get(i)?.note;
      return { name: n ? `${items[i]!.name} (${n})` : items[i]!.name, price: price(i) };
    }), itemCurrency);
    const tagsOf = (cat: string | null) => [...new Set(inGroup(cat).flatMap((i) => edits.get(i)?.tag_ids ?? []))];
    resolvePick(p.split, {
      category_id: plan.category_id, note: noteOf(plan.category_id), tag_ids: tagsOf(plan.category_id), date: shownDay, basis: plan.basis,
      ...(askAccount && payId ? { account_id: payId } : {}),
      parts: plan.parts.map((x) => ({ ...x, note: noteOf(x.category_id), tag_ids: tagsOf(x.category_id) })),
    } satisfies PhotoSplit);
  };

  // ---- Text ---------------------------------------------------------------------------------------
  const [copied, setCopied] = useState(false);
  const copyAll = () => {
    if (!copyToClipboard(reading.lines.join("\n"))) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const nothing = reading.status === "failed" || (reading.status === "done" && !reading.lines.length);
  return (
    <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, S.lg) + S.lg }} stickyHeaderIndices={[0]}>
      {/* Pinned: whose receipt it is, the day, the total, and the one thing to do with it. */}
      <View style={styles.head}>
        {parse ? (
          <View style={styles.shop}>
            <View style={styles.shopText}>
              <Text style={styles.shopName}>{parse.merchant}</Text>
              <View style={styles.meta}>
                <Tap onPress={openDay} style={styles.day} accessibilityRole="button" accessibilityLabel={t("photo.read.dayA11y", { day: dayChipLabel(shownDay) })}>
                  <SymbolView name="calendar" size={13} tintColor={C.tint} />
                  <Text style={styles.dayText}>{dayChipLabel(shownDay)}</Text>
                </Tap>
                <Text style={styles.total}>{money(parse.total)} {itemCurrency}</Text>
              </View>
              {askAccount ? (
                <View style={styles.meta}>
                  <Tap onPress={openPay} style={styles.day} accessibilityRole="button" accessibilityLabel={t("photo.read.payA11y", { account: acctName(payAccount) ?? "" })}>
                    <SymbolView name={accountIcon(payAccount?.type ?? "bank")} size={13} tintColor={C.tint} />
                    <Text style={styles.dayText}>{acctName(payAccount)}</Text>
                    <SymbolView name="chevron.down" size={11} tintColor={C.tertiary} />
                  </Tap>
                  {cross ? <Text style={styles.total}>{payRate ? `≈ ${formatMinor(toMinor(parse.total * payRate, payCurrency), payCurrency)} ${payCurrency}` : t("photo.read.noRate", { currency: payCurrency })}</Text> : null}
                </View>
              ) : null}
            </View>
            {canContinue ? (
              <Tap onPress={go} style={styles.go} accessibilityRole="button" accessibilityLabel={t("photo.read.continue")}>
                <Text style={styles.goText}>{t("photo.read.continue")}</Text>
              </Tap>
            ) : null}
          </View>
        ) : null}
        {items.length || (busy && reading.lines.length) ? (
          <View style={styles.tabs}>
            {items.length ? (
              <>
                <Tap onPress={() => setTab("items")} style={[styles.seg, tab === "items" && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === "items" }} accessibilityLabel={t("photo.read.items", { count: items.length })}>
                  <Text style={styles.segText}>{t("photo.read.items", { count: items.length })}</Text>
                </Tap>
                <Tap onPress={() => setTab("text")} style={[styles.seg, tab === "text" && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === "text" }} accessibilityLabel={t("photo.read.text")}>
                  <Text style={styles.segText}>{t("photo.read.text")}</Text>
                </Tap>
              </>
            ) : null}
            <View style={{ flex: 1 }} />
            {busy ? <ActivityIndicator size="small" /> : null}
          </View>
        ) : null}
      </View>

      {nothing ? (
        <Text style={styles.empty}>{t("photo.read.noText")}</Text>
      ) : !reading.lines.length ? (
        <ActivityIndicator size="large" style={{ paddingVertical: S.xxl }} />
      ) : tab === "text" || !items.length ? (
        <View>
          <ReceiptText lines={reading.lines} />
          <Tap onPress={copyAll} style={styles.copy} accessibilityRole="button" accessibilityLabel={copied ? t("photo.read.copied") : t("photo.read.copyAll")}>
            <SymbolView name={copied ? "checkmark" : "doc.on.doc"} size={14} tintColor={C.tint} />
            <Text style={styles.copyText}>{copied ? t("photo.read.copied") : t("photo.read.copyAll")}</Text>
          </Tap>
        </View>
      ) : (
        <View>
          {groups.map((g) => (
            <View key={g.cat ?? "none"}>
              {g.header ? (
                // Tapping a group's name moves all of it to another category.
                <Tap onPress={() => openGroup(g.cat, g.indices)} style={styles.group} accessibilityRole="button" accessibilityLabel={`${g.header}, ${money(g.sum)} ${itemCurrency}`}>
                  <View style={[styles.dot, { backgroundColor: g.color }]} />
                  <Text style={styles.groupText}>{g.header}</Text>
                  <Text style={styles.groupSum}>{money(g.sum)}</Text>
                </Tap>
              ) : null}
              {g.indices.map((i) => {
                const it = items[i]!;
                const e = edits.get(i);
                return (
                  <Tap key={i} onPress={() => openItem(i)} style={styles.item} accessibilityRole="button" accessibilityLabel={`${it.name}, ${money(price(i))} ${itemCurrency}`}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.itemName}>{it.name}</Text>
                      {e?.tag_ids?.length ? <Text style={styles.itemMeta}>{e.tag_ids.map((x) => `#${tagRows.get(x)?.name ?? ""}`).join(" ")}</Text> : null}
                      {e?.note ? <Text style={styles.itemMeta}>{e.note}</Text> : null}
                    </View>
                    <Text style={[styles.price, e?.price !== undefined && { color: C.tint }]}>{money(price(i))}{cross ? <Text style={styles.priceCur}> {itemCurrency}</Text> : null}</Text>
                  </Tap>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// A price at the end of a line, as a till prints it: "12.46A", "3,00 B", "-1.50".
const PRICED = /^(.*\S)\s+(-?\d[\d ]*[.,]\d{2}\s?\p{L}?)$/u;
const RULE = /^[-=_*.·•~\s]{4,}$/;
const SUM = /^(suma(?!\s+ptu)|razem|do zap[lł]aty|total|итого|сума|разом)\b/i;
const HEADING = /^(paragon\s+(nie)?fiskalny|e-?paragon)\b/i;

/**
 * The text as the receipt prints it: the shop's header centred, each priced line with its price at
 * the right edge, the fiscal heading and the sum set apart by rules. Laid out from the lines alone,
 * so it works for any till and any language; a photo that is not a receipt has no priced lines and
 * reads as plain left-aligned text.
 */
function ReceiptText({ lines }: { lines: string[] }) {
  // The shop's header: everything above the fiscal heading, or above the first priced line without one.
  const heading = lines.findIndex((l) => HEADING.test(l.trim()));
  const headEnd = heading >= 0 ? heading : lines.findIndex((l) => PRICED.test(l.trim()));
  return (
    <View style={styles.paper}>
      {lines.map((raw, i) => {
        const l = raw.trim();
        if (RULE.test(l)) return <View key={i} style={styles.rule} />;
        const sum = SUM.test(l);
        const heading = i === headEnd && HEADING.test(l);
        const m = l.match(PRICED);
        const line = m ? (
          <View style={styles.row}>
            <Text style={[styles.mono, { flex: 1 }, sum && styles.bold]}>{m[1]}</Text>
            <Text style={[styles.mono, sum && styles.bold]}>{m[2]}</Text>
          </View>
        ) : (
          <Text style={[styles.mono, (heading || i < headEnd) && styles.center, (heading || sum) && styles.bold]}>{l}</Text>
        );
        return (
          <View key={i}>
            {heading || sum ? <View style={styles.rule} /> : null}
            {line}
          </View>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  sheet: { flex: 1, backgroundColor: C.bgGrouped },
  head: { backgroundColor: C.bgGrouped, paddingHorizontal: S.lg, paddingTop: S.xl, paddingBottom: S.md, gap: S.lg },
  shop: { flexDirection: "row", alignItems: "flex-start", gap: S.md },
  shopName: { color: C.label, fontSize: 20, fontWeight: "700" },
  shopText: { flex: 1, gap: S.sm },
  // No flexWrap: Yoga under-measures a wrapping row whose children have a minHeight, so the day pill
  // was drawn taller than its row and ran into the tabs below. Long text wraps inside its own slot.
  meta: { flexDirection: "row", alignItems: "center", gap: S.md },
  day: { flexDirection: "row", alignItems: "center", gap: S.xs + 2, paddingHorizontal: S.md, paddingVertical: S.xs + 2, minHeight: 32, flexShrink: 1, borderRadius: R.pill, backgroundColor: C.fill },
  dayText: { ...Type.callout, fontWeight: "600", color: C.tint, flexShrink: 1 },
  total: { color: C.secondary, fontSize: 15, fontVariant: ["tabular-nums"], flexShrink: 1 },
  priceCur: { color: C.secondary, fontSize: 13 },
  go: { paddingHorizontal: S.lg + 2, paddingVertical: S.sm, minHeight: 44, borderRadius: R.pill, backgroundColor: C.tint, justifyContent: "center" },
  goText: { ...Type.headline, color: C.onTint },
  tabs: { flexDirection: "row", alignItems: "center", gap: S.xs },
  seg: { paddingHorizontal: S.md + 2, paddingVertical: S.xs + 2, minHeight: 36, borderRadius: R.pill, justifyContent: "center" },
  segOn: { backgroundColor: C.fill },
  segText: { color: C.label, fontSize: 15, fontWeight: "600" },
  empty: { color: C.secondary, fontSize: 15, paddingVertical: S.xl, textAlign: "center" },
  group: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: S.lg, paddingBottom: 4, paddingHorizontal: S.lg },
  groupText: { flex: 1, color: C.secondary, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  groupSum: { color: C.secondary, fontSize: 13, fontVariant: ["tabular-nums"] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: 11, paddingHorizontal: S.lg },
  itemName: { color: C.label, fontSize: 17 },
  itemMeta: { color: C.secondary, fontSize: 13 },
  price: { color: C.label, fontSize: 17, fontVariant: ["tabular-nums"] },
  paper: { marginHorizontal: S.lg, marginTop: S.sm, paddingVertical: S.lg, paddingHorizontal: S.lg, borderRadius: R.md, backgroundColor: C.card, gap: 2 },
  row: { flexDirection: "row", gap: S.md },
  mono: { color: C.label, fontFamily: Fonts.mono, fontSize: 13, lineHeight: 19 },
  center: { textAlign: "center" },
  bold: { fontWeight: "700" },
  rule: { borderBottomWidth: 1, borderStyle: "dashed", borderColor: C.tertiary, marginVertical: 6 },
  copy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", paddingHorizontal: S.lg, paddingVertical: S.sm, minHeight: 36, borderRadius: R.pill, backgroundColor: C.fill, marginTop: S.md },
  copyText: { color: C.tint, fontSize: 15, fontWeight: "600" },
}));
