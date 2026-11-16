import { useEffect, useMemo, useRef, useState } from "react";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Tap } from "@/components/ui";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { archivedCategoryIds, folderIds, formatMinor, listRows, receiptSplit, toMinor } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { usePhotoReading } from "@/lib/photoText";
import { copyToClipboard } from "@/lib/device";
import { catName } from "@/lib/names";
import { itemsNote } from "@/lib/receiptFill";
import { S } from "@/constants/theme";
import { t } from "@/i18n";

/** A line of light sweeping down the photo while its text is being read. */
function ScanLine({ height }: { height: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(y);
  }, [y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * height * 0.8 + height * 0.08 }] }));
  return (
    <Animated.View pointerEvents="none" entering={FadeIn} exiting={FadeOut.duration(400)} style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <Animated.View style={[styles.scanBand, style]}>
        <View style={styles.scanGlow} />
        <View style={styles.scanLine} />
      </Animated.View>
    </Animated.View>
  );
}

/** What "Split" hands back to the entry sheet: the entry's category and the parts to carve off. */
export interface PhotoSplit {
  category_id: string | null;
  /** Each with the lines of the items that made it, for its note. */
  parts: { category_id: string; amount_minor: number; note?: string }[];
  /** The lines of the items that stayed with the entry. */
  note?: string;
}

// The panel stays as it was left, from one photo to the next.
let panelOpen = false;

/**
 * Full-screen look at a transaction's photo.
 *
 * Pinch to zoom, double-tap to zoom in on that spot and again to come back. Underneath, a panel
 * with what the photo says (lib/photoText.ts — read in the background, kept, so a second look is
 * instant): the text, selectable and copyable, and for a receipt its items. Opened from an
 * expense's sheet (`split`, `total`), the items can be sorted into categories — the on-device
 * model's guesses come pre-filled — and "Split" hands the parts back to the sheet, which opens the
 * split editor on them (DATA.md rule 11: they become ordinary entries only when that is kept).
 *
 * "Remove" resolves `key` with `true` to the caller; retaking happens from the sheet.
 */
export default function PhotoView() {
  const p = useLocalSearchParams<{ uri: string; key?: string; split?: string; total?: string; currency?: string; category?: string; replace?: string; fill?: string }>();
  // The photo on screen: the one opened with, until it is replaced here.
  const [uri, setUri] = useState(p.uri);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reading = usePhotoReading(uri);
  const replacePhoto = () => router.push({ pathname: "/photo/capture", params: { key: replaceKey } });
  // Everything the reader found that the entry can take: one tap, back to the sheet, filled in.
  const canFill = !!p.fill && !!reading.parse && reading.parse.total > 0;
  const fill = () => { if (!p.fill) return; void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); resolvePick(p.fill, true); router.back(); };

  // ---- Zoom ---------------------------------------------------------------------------------------
  const zoomRef = useRef<ScrollView>(null);
  const scale = useRef(1);
  const lastTap = useRef(0);
  const onImagePress = (e: GestureResponderEvent) => {
    const now = Date.now();
    if (now - lastTap.current > 300) { lastTap.current = now; return; }
    lastTap.current = 0;
    const view = zoomRef.current as unknown as { scrollResponderZoomTo?: (r: { x: number; y: number; width: number; height: number; animated?: boolean }) => void } | null;
    if (scale.current > 1.05) { view?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: true }); return; }
    const { locationX: x, locationY: y } = e.nativeEvent;
    const w = width / 3, h = height / 3;
    view?.scrollResponderZoomTo?.({ x: x - w / 2, y: y - h / 2, width: w, height: h, animated: true });
  };

  // ---- Panel --------------------------------------------------------------------------------------
  const [open, setOpenState] = useState(panelOpen);
  const setOpen = (v: boolean) => { panelOpen = v; setOpenState(v); };
  const items = useMemo(() => reading.parse?.items ?? [], [reading.parse]);
  // A receipt read with items opens on them; a photo of anything else stays on its text.
  const [tabChoice, setTab] = useState<"text" | "items" | null>(null);
  const tab = tabChoice ?? (items.length ? "items" : "text");
  const busy = reading.status === "reading" || reading.status === "text" || reading.status === "items";
  const [copied, setCopied] = useState(false);
  const copyAll = () => {
    if (!copyToClipboard(reading.lines.join("\n"))) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ---- Sorting items into categories ----------------------------------------------------------------
  const cats = useQuery((d) => listRows(d, "categories", "deleted=0"), []);
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  // Only what a transaction may be filed under: no folders, nothing archived (DATA.md rules 5, 14).
  const pickable = useMemo(() => {
    const folders = folderIds(cats), archived = archivedCategoryIds(cats);
    return new Set(cats.filter((c) => c.kind === "expense" && !folders.has(c.id) && !archived.has(c.id)).map((c) => c.id));
  }, [cats]);
  const canSplit = !!p.split && Number(p.total) > 0;
  // What a person set, by item; everything else is the model's guess, which arrives after the items.
  const [chosenCats, setChosenCats] = useState<Map<number, string | null>>(new Map());
  const assigned = useMemo(() => items.map((_, i) => {
    if (chosenCats.has(i)) return chosenCats.get(i) ?? null;
    const id = reading.cats[i];
    return id && pickable.has(id) ? id : null;
  }), [items, chosenCats, reading.cats, pickable]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // A new photo is read from the start: what was picked and sorted belonged to the old one.
  const [replaceKey] = useState(() => newPickKey("photoreplace"));
  usePickResult<string>(replaceKey, (next: string) => {
    setUri(next); setChosenCats(new Map()); setSelected(new Set()); setTab(null);
    if (p.replace) resolvePick(p.replace, next);
  });

  const [pickKey] = useState(() => newPickKey("photocat"));
  usePickResult<string | null>(pickKey, (v: string | null) => {
    if (v?.startsWith("debt:")) return;
    setChosenCats((cur) => { const n = new Map(cur); for (const i of selected) n.set(i, v); return n; });
    setSelected(new Set());
  });
  // The items under the category each is in, in the order the categories first appear on the
  // receipt; what is not sorted comes last, as what stays with this entry. One unsorted lot has no header.
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
        header: keys.length === 1 && k === null ? null : c ? catName(c) : t("photo.read.unsorted"),
        sum: indices.reduce((a, i) => a + (items[i]?.price ?? 0), 0),
      };
    });
  }, [items, assigned, byId]);
  const selectGroup = (indices: number[]) => setSelected((cur) => {
    const all = indices.every((i) => cur.has(i));
    const n = new Set(cur);
    for (const i of indices) { if (all) n.delete(i); else n.add(i); }
    return n;
  });
  const toggle = (i: number) => setSelected((cur) => { const n = new Set(cur); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const fileSelected = () => router.push({ pathname: "/pick/category", params: { key: pickKey, kind: "expense", selected: assigned[[...selected][0]!] ?? "" } });

  const itemCurrency = reading.parse?.currency ?? p.currency ?? "EUR";
  const money = (major: number) => formatMinor(toMinor(major, itemCurrency), itemCurrency);
  const selectedSum = [...selected].reduce((a, i) => a + (items[i]?.price ?? 0), 0);

  const entryCategory = p.category || null;
  const plan = useMemo(() => (canSplit && items.length
    ? receiptSplit(items.map((it, i) => ({ price: it.price, category_id: assigned[i] ?? null })), reading.parse?.total ?? 0, Number(p.total), entryCategory)
    : null), [canSplit, items, assigned, reading.parse, p.total, entryCategory]);
  const planChanges = !!plan && (plan.parts.length > 0 || plan.category_id !== entryCategory);
  const nameOf = (id: string | null) => { const c = id ? byId.get(id) : null; return c ? catName(c) : t("photo.read.uncategorized"); };
  const applyPlan = () => {
    if (!plan || !p.split) return;
    const of = (cat: string | null) => itemsNote(items.filter((_, i) => (cat === plan.category_id ? !assigned[i] || assigned[i] === cat : assigned[i] === cat)), itemCurrency);
    resolvePick(p.split, { category_id: plan.category_id, parts: plan.parts.map((x) => ({ ...x, note: of(x.category_id) })), note: of(plan.category_id) } satisfies PhotoSplit);
    router.back();
  };

  const panelHeight = Math.round(height * 0.46);
  return (
    <View style={styles.screen}>
      <ScrollView ref={zoomRef} style={StyleSheet.absoluteFill} contentContainerStyle={{ width, height }}
        maximumZoomScale={6} minimumZoomScale={1} bouncesZoom centerContent
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
        onScroll={(e) => { scale.current = e.nativeEvent.zoomScale ?? 1; }} scrollEventThrottle={64}
        accessible accessibilityLabel={t("photo.read.zoomA11y")}>
        <Pressable onPress={onImagePress} style={{ width, height }}>
          <Image source={{ uri }} style={{ width, height }} contentFit="contain" transition={250} accessibilityLabel={t("photo.attached")} accessibilityIgnoresInvertColors />
        </Pressable>
      </ScrollView>
      {reading.status === "reading" ? <ScanLine key={uri} height={height} /> : null}

      <Tap onPress={() => router.back()} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, right: S.lg }]} accessibilityRole="button" accessibilityLabel={t("common.close")}>
        <SymbolView name="xmark" size={18} tintColor="white" weight="semibold" />
      </Tap>
      {p.key ? (
        <Tap onPress={() => { resolvePick(p.key!, true); router.back(); }} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, left: S.lg }]} accessibilityRole="button" accessibilityLabel={t("photo.remove")}>
          <SymbolView name="trash" size={17} tintColor="#ff6961" />
        </Tap>
      ) : null}
      {p.replace ? (
        <Tap onPress={replacePhoto} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, left: S.lg + (p.key ? 52 : 0) }]} accessibilityRole="button" accessibilityLabel={t("photo.replace")}>
          <SymbolView name="camera.rotate" size={17} tintColor="white" />
        </Tap>
      ) : null}

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
        {canFill ? (
          <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.fillWrap}>
            <Tap onPress={fill} style={styles.fill} accessibilityRole="button">
              <SymbolView name="wand.and.sparkles" size={15} tintColor="white" />
              <Text style={styles.fillText} numberOfLines={1}>{t("photo.read.fill", { amount: money(reading.parse!.total) })}</Text>
            </Tap>
          </Animated.View>
        ) : null}
        <View style={styles.head}>
          <Tap onPress={() => { setTab("text"); setOpen(true); }} style={[styles.seg, open && tab === "text" && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: open && tab === "text" }}>
            <SymbolView name="text.viewfinder" size={14} tintColor="white" />
            <Text style={styles.segText}>{t("photo.read.text")}</Text>
          </Tap>
          {items.length ? (
            <Tap onPress={() => { setTab("items"); setOpen(true); }} style={[styles.seg, open && tab === "items" && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: open && tab === "items" }}>
              <SymbolView name="list.bullet.rectangle" size={14} tintColor="white" />
              <Text style={styles.segText}>{t("photo.read.items", { count: items.length })}</Text>
            </Tap>
          ) : null}
          <View style={{ flex: 1 }} />
          {busy ? (
            <View style={styles.status}>
              <ActivityIndicator color="white" size="small" />
              <Text style={styles.statusText} numberOfLines={1}>{reading.status === "reading" ? t("photo.read.reading") : reading.status === "text" ? t("photo.read.findingItems") : t("photo.read.sorting")}</Text>
            </View>
          ) : null}
          <Tap onPress={() => setOpen(!open)} hitSlop={10} style={styles.chevron} accessibilityRole="button" accessibilityLabel={open ? t("photo.read.hide") : t("photo.read.show")}>
            <SymbolView name={open ? "chevron.down" : "chevron.up"} size={15} tintColor="white" weight="semibold" />
          </Tap>
        </View>

        {open ? (
          <View style={{ height: panelHeight }}>
            {tab === "text" || !items.length ? (
              reading.status === "failed" || (reading.status === "done" && !reading.lines.length) ? (
                <Text style={styles.empty}>{t("photo.read.noText")}</Text>
              ) : !reading.lines.length ? (
                <Text style={styles.empty}>{t("photo.read.reading")}</Text>
              ) : (
                <>
                  {/* Not editable, still selectable: drag across any part of it and Copy. */}
                  <TextInput value={reading.lines.join("\n")} editable={false} multiline scrollEnabled style={styles.text} accessibilityLabel={t("photo.read.text")} />
                  <Tap onPress={copyAll} style={styles.copy} accessibilityRole="button">
                    <SymbolView name={copied ? "checkmark" : "doc.on.doc"} size={14} tintColor="white" />
                    <Text style={styles.copyText}>{copied ? t("photo.read.copied") : t("photo.read.copyAll")}</Text>
                  </Tap>
                </>
              )
            ) : (
              <>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: S.md }}>
                  {canSplit ? <Text style={styles.hint}>{t("photo.read.sortHint")}</Text> : null}
                  {groups.map((g) => (
                    <View key={g.cat ?? "none"}>
                      {g.header ? (
                        // Tapping a group picks all of it, to move the lot somewhere else in one go.
                        <Tap onPress={canSplit ? () => selectGroup(g.indices) : undefined} disabled={!canSplit} style={styles.group} accessibilityRole={canSplit ? "button" : "header"}>
                          <View style={[styles.dot, { backgroundColor: g.color }]} />
                          <Text style={styles.groupText} numberOfLines={1}>{g.header}</Text>
                          <Text style={styles.groupSum}>{money(g.sum)}</Text>
                        </Tap>
                      ) : null}
                      {g.indices.map((i) => {
                        const it = items[i]!;
                        const on = selected.has(i);
                        return (
                          <Tap key={i} onPress={canSplit ? () => toggle(i) : undefined} disabled={!canSplit} style={[styles.item, on && styles.itemOn]}
                            accessibilityRole={canSplit ? "checkbox" : undefined} accessibilityState={canSplit ? { checked: on } : undefined}>
                            {canSplit ? (
                              <SymbolView name={on ? "checkmark.circle.fill" : "circle"} size={20} tintColor={on ? "#0a84ff" : "rgba(255,255,255,0.45)"} />
                            ) : null}
                            <Text style={[styles.itemName, { flex: 1 }]} numberOfLines={2}>{it.name}</Text>
                            {assigned[i] && !chosenCats.has(i) ? <SymbolView name="sparkles" size={11} tintColor="rgba(255,255,255,0.55)" accessibilityLabel={t("photo.read.suggested")} /> : null}
                            <Text style={styles.price}>{money(it.price)}</Text>
                          </Tap>
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
                {canSplit && selected.size ? (
                  <View style={styles.bar}>
                    <Text style={styles.barText} numberOfLines={1}>{t("photo.read.selected", { count: selected.size, amount: money(selectedSum) })}</Text>
                    <Tap onPress={() => setSelected(new Set())} style={styles.barGhost} accessibilityRole="button"><Text style={styles.copyText}>{t("common.cancel")}</Text></Tap>
                    <Tap onPress={fileSelected} style={styles.barBtn} accessibilityRole="button"><Text style={styles.barBtnText}>{t("photo.read.category")}</Text></Tap>
                  </View>
                ) : canSplit && planChanges && plan ? (
                  <Tap onPress={applyPlan} style={styles.split} accessibilityRole="button">
                    <Text style={styles.splitText}>{plan.parts.length ? t("photo.read.split", { count: plan.parts.length + 1 }) : t("photo.read.fileAs", { category: nameOf(plan.category_id) })}</Text>
                    {plan.parts.length ? (
                      <Text style={styles.splitSub} numberOfLines={1}>{[nameOf(plan.category_id), ...plan.parts.map((x) => nameOf(x.category_id))].join(" · ")}</Text>
                    ) : null}
                  </Tap>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "black" },
  btn: { position: "absolute", width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  scanBand: { position: "absolute", left: 0, right: 0, top: 0, height: 64, justifyContent: "flex-end" },
  scanGlow: { flex: 1, backgroundColor: "rgba(90,200,250,0.16)" },
  scanLine: { height: 2, backgroundColor: "#5ac8fa", shadowColor: "#5ac8fa", shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  fillWrap: { position: "absolute", top: -56, left: 0, right: 0, alignItems: "center" },
  fill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, height: 42, borderRadius: 21, backgroundColor: "#0a84ff", shadowColor: "black", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  fillText: { color: "white", fontSize: 16, fontWeight: "600" },
  panel: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,28,30,0.94)", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: S.lg, paddingTop: S.sm },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 44 },
  seg: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16 },
  segOn: { backgroundColor: "rgba(255,255,255,0.16)" },
  segText: { color: "white", fontSize: 15, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  statusText: { color: "rgba(255,255,255,0.7)", fontSize: 13, flexShrink: 1 },
  chevron: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  empty: { color: "rgba(255,255,255,0.7)", fontSize: 15, paddingVertical: S.lg, textAlign: "center" },
  text: { flex: 1, color: "white", fontSize: 15, lineHeight: 21, fontFamily: "Menlo", paddingTop: S.sm },
  copy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.16)", marginTop: S.sm },
  copyText: { color: "white", fontSize: 15, fontWeight: "600" },
  hint: { color: "rgba(255,255,255,0.65)", fontSize: 13, paddingVertical: S.sm },
  group: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: S.md, paddingBottom: 4, paddingHorizontal: S.sm },
  groupText: { flex: 1, color: "white", fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  groupSum: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontVariant: ["tabular-nums"] },
  item: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: 10, paddingHorizontal: S.sm, borderRadius: 10 },
  itemOn: { backgroundColor: "rgba(10,132,255,0.22)" },
  itemName: { color: "white", fontSize: 15 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  price: { color: "white", fontSize: 15, fontVariant: ["tabular-nums"] },
  bar: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingTop: S.sm },
  barText: { flex: 1, color: "white", fontSize: 14 },
  barGhost: { paddingHorizontal: 12, height: 36, justifyContent: "center" },
  barBtn: { paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: "#0a84ff", justifyContent: "center" },
  barBtnText: { color: "white", fontSize: 15, fontWeight: "600" },
  split: { marginTop: S.sm, borderRadius: 14, backgroundColor: "#0a84ff", paddingVertical: 10, paddingHorizontal: S.lg, alignItems: "center" },
  splitText: { color: "white", fontSize: 16, fontWeight: "600" },
  splitSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
});
