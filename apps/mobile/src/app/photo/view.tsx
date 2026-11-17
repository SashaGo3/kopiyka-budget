import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import { ActivityIndicator, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Tap } from "@/components/ui";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { archivedCategoryIds, folderIds, formatMinor, listRows, receiptSplit, snapIndex, toMinor } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { usePhotoReading } from "@/lib/photoText";
import { copyToClipboard } from "@/lib/device";
import { catName } from "@/lib/names";
import { itemsNote } from "@/lib/receiptFill";
import { dayChipLabel } from "@/lib/dates";
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
  /** Each with the lines of the items that made it, for its note, and the tags given to them. */
  parts: { category_id: string; amount_minor: number; note?: string; tag_ids?: string[] }[];
  /** The lines of the items that stayed with the entry, and the tags given to those. */
  note?: string;
  tag_ids?: string[];
}

// The panel stays as it was left, from one photo to the next.
let panelSnap = 1;

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
  const p = useLocalSearchParams<{ uri: string; key?: string; split?: string; total?: string; currency?: string; category?: string; replace?: string; fill?: string; unfill?: string; filled?: string }>();
  // The photo on screen: the one opened with, until it is replaced here.
  const [uri, setUri] = useState(p.uri);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reading = usePhotoReading(uri);
  const replacePhoto = () => router.push({ pathname: "/photo/capture", params: { key: replaceKey } });
  // Everything the reader found that the entry can take: one tap, back to the sheet, filled in.
  const canFill = !!p.fill && !!reading.parse && reading.parse.total > 0;
  const fill = () => { if (!p.fill) return; void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); resolvePick(p.fill, true); router.back(); };

  // The photo takes the screen above the panel, never under it, so its bottom line can be read.
  // ---- The sheet ------------------------------------------------------------------------------------
  // Dragged by its top (the grabber, the shop, the tabs) between three resting places, as the app's
  // sheets are: just that top, half the screen, nearly all of it. Where it was left is where the next
  // photo opens it.
  const [headH, setHeadH] = useState(120);
  const bottomPad = Math.max(insets.bottom, S.md);
  const snaps = useMemo(() => [headH + bottomPad, Math.round(height * 0.5), Math.round(height * 0.88)], [headH, bottomPad, height]);
  const [snap, setSnapState] = useState(panelSnap);
  const sheetH = useSharedValue(snaps[panelSnap]!);
  const setSnap = useCallback((i: number) => { panelSnap = i; setSnapState(i); }, []);
  useEffect(() => { sheetH.set(withSpring(snaps[snap]!, { damping: 22, stiffness: 220 })); }, [snap, snaps, sheetH]);
  const dragFrom = useSharedValue(0);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { dragFrom.set(sheetH.get()); },
    onPanResponderMove: (_, g) => { sheetH.set(Math.min(Math.max(dragFrom.get() - g.dy, snaps[0]!), snaps[2]!)); },
    onPanResponderRelease: (_, g) => {
      const i = snapIndex(snaps, dragFrom.get() - g.dy, -g.vy);
      setSnap(i);
      sheetH.set(withSpring(snaps[i]!, { damping: 22, stiffness: 220, velocity: -g.vy * 1000 }));
    },
  }), [snaps, sheetH, dragFrom, setSnap]);
  const sheetStyle = useAnimatedStyle(() => ({ height: sheetH.get() }));
  // The photo takes the screen above the sheet, never under it, so its last line can be read.
  const imgH = Math.max(height - snaps[snap]!, 120);
  // ---- Zoom ---------------------------------------------------------------------------------------
  const zoomRef = useRef<ScrollView>(null);
  const scale = useRef(1);
  const lastTap = useRef(0);
  const onImagePress = (e: GestureResponderEvent) => {
    const now = Date.now();
    if (now - lastTap.current > 300) { lastTap.current = now; return; }
    lastTap.current = 0;
    const view = zoomRef.current as unknown as { scrollResponderZoomTo?: (r: { x: number; y: number; width: number; height: number; animated?: boolean }) => void } | null;
    if (scale.current > 1.05) { view?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height: imgH, animated: true }); return; }
    const { locationX: x, locationY: y } = e.nativeEvent;
    const w = width / 3, h = imgH / 3;
    view?.scrollResponderZoomTo?.({ x: x - w / 2, y: y - h / 2, width: w, height: h, animated: true });
  };

  // ---- Panel --------------------------------------------------------------------------------------
  const open = snap > 0;
  const setOpen = (v: boolean) => setSnap(v ? Math.max(snap, 1) : 0);
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
  // What is being divided: the entry's amount, or — on a new entry not filled in yet — the
  // receipt's own total, when it is in the entry's currency (the sheet fills the same amount in).
  const entryTotal = Number(p.total) > 0 ? Number(p.total)
    : reading.parse && p.currency && (!reading.parse.currency || reading.parse.currency === p.currency) ? toMinor(reading.parse.total, p.currency) : 0;
  const canSplit = !!p.split && entryTotal > 0;
  // What a person set, by item; everything else is the model's guess, which arrives after the items.
  const [chosenCats, setChosenCats] = useState<Map<number, string | null>>(new Map());
  const assigned = useMemo(() => items.map((_, i) => {
    if (chosenCats.has(i)) return chosenCats.get(i) ?? null;
    const id = reading.cats[i];
    return id && pickable.has(id) ? id : null;
  }), [items, chosenCats, reading.cats, pickable]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Tags and a note per item: they go with whatever part the item ends up in.
  const [itemTags, setItemTags] = useState<Map<number, string[]>>(new Map());
  const [itemNotes, setItemNotes] = useState<Map<number, string>>(new Map());
  // A new photo is read from the start: what was picked and sorted belonged to the old one.
  const [replaceKey] = useState(() => newPickKey("photoreplace"));
  usePickResult<string>(replaceKey, (next: string) => {
    setUri(next); setChosenCats(new Map()); setSelected(new Set()); setTab(null); setItemTags(new Map()); setItemNotes(new Map());
    if (p.replace) resolvePick(p.replace, next);
  });

  const [tagKey] = useState(() => newPickKey("phototags"));
  const [noteKey] = useState(() => newPickKey("photonote"));
  usePickResult<string[]>(tagKey, (v: string[]) => {
    setItemTags((cur) => { const n = new Map(cur); for (const i of selected) n.set(i, v); return n; });
    setSelected(new Set());
  });
  usePickResult<string>(noteKey, (v: string) => {
    setItemNotes((cur) => { const n = new Map(cur); for (const i of selected) { if (v) n.set(i, v); else n.delete(i); } return n; });
    setSelected(new Set());
  });
  const tagRows = useQuery((d) => new Map(listRows(d, "tags", "deleted=0").map((x) => [x.id, x])), []);
  const tagSelected = () => router.push({ pathname: "/pick/tags", params: { key: tagKey, selected: [...new Set([...selected].flatMap((i) => itemTags.get(i) ?? []))].join(","), category: assigned[[...selected][0]!] ?? "" } });
  const noteSelected = () => router.push({ pathname: "/pick/text", params: { key: noteKey, title: t("transaction.split.note"), value: itemNotes.get([...selected][0]!) ?? "", multiline: "1" } });

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
    ? receiptSplit(items.map((it, i) => ({ price: it.price, category_id: assigned[i] ?? null })), reading.parse?.total ?? 0, entryTotal, entryCategory)
    : null), [canSplit, items, assigned, reading.parse, entryTotal, entryCategory]);
  const extras = itemTags.size > 0 || itemNotes.size > 0;
  const planChanges = !!plan && (plan.parts.length > 0 || plan.category_id !== entryCategory || extras);
  const nameOf = (id: string | null) => { const c = id ? byId.get(id) : null; return c ? catName(c) : t("photo.read.uncategorized"); };
  const applyPlan = () => {
    if (!plan || !p.split) return;
    const inGroup = (cat: string | null) => items.map((_, i) => i).filter((i) => (cat === plan.category_id ? !assigned[i] || assigned[i] === cat : assigned[i] === cat));
    const noteOf = (cat: string | null) => itemsNote(inGroup(cat).map((i) => ({ name: itemNotes.get(i) ? `${items[i]!.name} (${itemNotes.get(i)})` : items[i]!.name, price: items[i]!.price })), itemCurrency);
    const tagsOf = (cat: string | null) => [...new Set(inGroup(cat).flatMap((i) => itemTags.get(i) ?? []))];
    resolvePick(p.split, {
      category_id: plan.category_id, note: noteOf(plan.category_id), tag_ids: tagsOf(plan.category_id),
      parts: plan.parts.map((x) => ({ ...x, note: noteOf(x.category_id), tag_ids: tagsOf(x.category_id) })),
    } satisfies PhotoSplit);
    router.back();
  };

  return (
    <View style={styles.screen}>
      <ScrollView ref={zoomRef} style={{ position: "absolute", top: 0, left: 0, right: 0, height: imgH }} contentContainerStyle={{ width, height: imgH }}
        maximumZoomScale={6} minimumZoomScale={0.5} bouncesZoom centerContent
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
        onScroll={(e) => { scale.current = e.nativeEvent.zoomScale ?? 1; }} scrollEventThrottle={64}
        accessible accessibilityLabel={t("photo.read.zoomA11y")}>
        <Pressable onPress={onImagePress} style={{ width, height: imgH }}>
          <Image source={{ uri }} style={{ width, height: imgH }} contentFit="contain" transition={250} accessibilityLabel={t("photo.attached")} accessibilityIgnoresInvertColors />
        </Pressable>
      </ScrollView>
      {reading.status === "reading" ? <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: imgH }}><ScanLine key={uri} height={imgH} /></View> : null}

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

      <Animated.View style={[styles.panel, { paddingBottom: bottomPad }, sheetStyle]}>
        <View {...pan.panHandlers} onLayout={(e) => setHeadH(Math.round(e.nativeEvent.layout.height))}>
        <Tap onPress={() => setSnap(snap === 0 ? 1 : snap === 1 ? 2 : 0)} hitSlop={8} style={styles.grabberHit} accessibilityRole="adjustable" accessibilityLabel={t("photo.read.sheetA11y")}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(e) => setSnap(e.nativeEvent.actionName === "increment" ? Math.min(snap + 1, 2) : Math.max(snap - 1, 0))}>
          <View style={styles.grabber} />
        </Tap>
        {/* Whose receipt this is — the shop, where it is, the day — and the one tap that takes it. */}
        {reading.parse && reading.parse.total > 0 ? (
          <Animated.View entering={FadeInDown.springify().damping(16)} layout={LinearTransition} style={styles.shop}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.shopName} numberOfLines={1}>{reading.parse.merchant}</Text>
              <Text style={styles.shopSub} numberOfLines={2}>{[reading.parse.address, reading.parse.date ? dayChipLabel(reading.parse.date) : null, money(reading.parse.total)].filter(Boolean).join(" · ")}</Text>
            </View>
            {p.filled && p.unfill ? (
              // Filled in already: what the receipt put on the entry can be taken off it again here.
              <Tap onPress={() => { resolvePick(p.unfill!, true); router.back(); }} style={[styles.fill, styles.unfill]} accessibilityRole="button">
                <SymbolView name="arrow.uturn.backward" size={14} tintColor="white" />
                <Text style={styles.fillText}>{t("photo.read.clear")}</Text>
              </Tap>
            ) : canFill ? (
              <Tap onPress={fill} style={styles.fill} accessibilityRole="button" accessibilityLabel={t("photo.read.fill", { amount: money(reading.parse.total) })}>
                <SymbolView name="wand.and.sparkles" size={14} tintColor="white" />
                <Text style={styles.fillText}>{t("photo.read.use")}</Text>
              </Tap>
            ) : null}
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

        </View>
        {open ? (
          <View style={{ flex: 1 }}>
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
                    <Animated.View key={g.cat ?? "none"} entering={FadeIn.duration(250)} layout={LinearTransition.springify().damping(18)}>
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
                          <Animated.View key={i} entering={FadeIn.duration(250)} layout={LinearTransition.springify().damping(18)}>
                          <Tap onPress={canSplit ? () => toggle(i) : undefined} disabled={!canSplit} style={[styles.item, on && styles.itemOn]}
                            accessibilityRole={canSplit ? "checkbox" : undefined} accessibilityState={canSplit ? { checked: on } : undefined}>
                            {canSplit ? (
                              <SymbolView name={on ? "checkmark.circle.fill" : "circle"} size={20} tintColor={on ? "#0a84ff" : "rgba(255,255,255,0.45)"} />
                            ) : null}
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
                              {itemTags.get(i)?.length ? <Text style={styles.itemMeta} numberOfLines={1}>{itemTags.get(i)!.map((x) => `#${tagRows.get(x)?.name ?? ""}`).join(" ")}</Text> : null}
                              {itemNotes.get(i) ? <Text style={styles.itemMeta} numberOfLines={2}>{itemNotes.get(i)}</Text> : null}
                            </View>
                            {assigned[i] && !chosenCats.has(i) ? <SymbolView name="sparkles" size={11} tintColor="rgba(255,255,255,0.55)" accessibilityLabel={t("photo.read.suggested")} /> : null}
                            <Text style={styles.price}>{money(it.price)}</Text>
                          </Tap>
                          </Animated.View>
                        );
                      })}
                    </Animated.View>
                  ))}
                </ScrollView>
                {canSplit && selected.size ? (
                  <View style={styles.bar}>
                    <Text style={styles.barText} numberOfLines={1}>{t("photo.read.selected", { count: selected.size, amount: money(selectedSum) })}</Text>
                    <Tap onPress={() => setSelected(new Set())} hitSlop={8} style={styles.barIcon} accessibilityRole="button" accessibilityLabel={t("common.cancel")}><SymbolView name="xmark" size={14} tintColor="white" /></Tap>
                    <Tap onPress={tagSelected} style={styles.barIcon} accessibilityRole="button" accessibilityLabel={t("photo.read.tags")}><SymbolView name="number" size={15} tintColor="white" /></Tap>
                    <Tap onPress={noteSelected} style={styles.barIcon} accessibilityRole="button" accessibilityLabel={t("photo.read.note")}><SymbolView name="text.alignleft" size={15} tintColor="white" /></Tap>
                    <Tap onPress={fileSelected} style={styles.barBtn} accessibilityRole="button"><Text style={styles.barBtnText}>{t("photo.read.category")}</Text></Tap>
                  </View>
                ) : canSplit && planChanges && plan ? (
                  <Tap onPress={applyPlan} style={styles.split} accessibilityRole="button">
                    <Text style={styles.splitText}>{plan.parts.length ? t("photo.read.split", { count: plan.parts.length + 1 }) : plan.category_id !== entryCategory ? t("photo.read.fileAs", { category: nameOf(plan.category_id) }) : t("photo.read.apply")}</Text>
                    {plan.parts.length ? (
                      <Text style={styles.splitSub} numberOfLines={1}>{[nameOf(plan.category_id), ...plan.parts.map((x) => nameOf(x.category_id))].join(" · ")}</Text>
                    ) : null}
                  </Tap>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "black" },
  btn: { position: "absolute", width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  scanBand: { position: "absolute", left: 0, right: 0, top: 0, height: 64, justifyContent: "flex-end" },
  scanGlow: { flex: 1, backgroundColor: "rgba(90,200,250,0.16)" },
  scanLine: { height: 2, backgroundColor: "#5ac8fa", shadowColor: "#5ac8fa", shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  shop: { flexDirection: "row", alignItems: "center", gap: S.md, paddingTop: S.sm, paddingBottom: S.xs },
  shopName: { color: "white", fontSize: 17, fontWeight: "700" },
  shopSub: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  unfill: { backgroundColor: "rgba(255,255,255,0.18)" },
  grabberHit: { alignSelf: "stretch", alignItems: "center", paddingTop: 2, paddingBottom: 4 },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.4)" },
  fill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, height: 38, borderRadius: 19, backgroundColor: "#0a84ff" },
  fillText: { color: "white", fontSize: 15, fontWeight: "600" },
  panel: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,28,30,0.94)", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: S.lg, paddingTop: S.sm , overflow: "hidden" },
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
  barIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  itemMeta: { color: "rgba(255,255,255,0.65)", fontSize: 13 },
  barGhost: { paddingHorizontal: 12, height: 36, justifyContent: "center" },
  barBtn: { paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: "#0a84ff", justifyContent: "center" },
  barBtnText: { color: "white", fontSize: 15, fontWeight: "600" },
  split: { marginTop: S.sm, borderRadius: 14, backgroundColor: "#0a84ff", paddingVertical: 10, paddingHorizontal: S.lg, alignItems: "center" },
  splitText: { color: "white", fontSize: 16, fontWeight: "600" },
  splitSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
});
