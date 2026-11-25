import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { measure, scrollTo, useAnimatedRef, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { Empty, ModalHeader, ButtonText } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/** A row's height before it has been measured; rows grow to hold their text (DESIGN.md §4). */
const H = 52;
/** The space under every row. */
const GAP = 6;
/** How close to the list's top or bottom edge the finger has to be before the list scrolls under it. */
const EDGE = 90;
/** The fastest it scrolls, in points a frame, with the finger right at the edge. */
const SPEED = 14;
/** How long a row takes to slide into a place it was pushed to, or dropped into. */
const MOVE = { duration: 180 };

/** `deletable` rows can be swiped left to reveal Delete; a row standing for a whole section cannot. */
export type ReorderItem = { id: string; title: string; subtitle?: string; icon?: ReactNode; deletable?: boolean;
  /**
   * A header that the rows after it, up to the next header, belong to (categories under their folder).
   * A row can be dragged into another section; a header carries its whole section with it — while one
   * is in the hand the list folds to headers only, and unfolds where it is dropped.
   */
  section?: boolean };

type Drag = {
  /** The row in the hand, or "" for none. */
  id: string;
  /** Where its top was at the grab, and the scroll offset then. */
  top: number; scroll: number;
  /** Where it may go among the rows that are showing: a row stays in its section, or under the first header. */
  min: number; max: number;
  /** The finger: its travel since the grab and its height on screen, for scrolling at the edges. */
  ty: number; absY: number;
  /** While a header is in the hand: each header's rows, put back under it on drop. */
  blocks: Record<string, string[]>;
};

/** Each row's top in the list, and the list's height, for an order and the rows' measured heights. */
function layout(order: string[], heights: Record<string, number>, hidden: Record<string, boolean>): { tops: Record<string, number>; total: number } {
  "worklet";
  const tops: Record<string, number> = {};
  let y = 0;
  for (const id of order) {
    tops[id] = y;
    if (!hidden[id]) y += (heights[id] ?? H) + GAP;
  }
  return { tops, total: y };
}

/** How fast to scroll for a finger at screen `absY` over a list at `top`, `height` tall: negative up, positive down, 0 away from the edges. */
function speedAt(top: number, height: number, absY: number): number {
  "worklet";
  if (!height) return 0;
  if (absY < top + EDGE) return -SPEED * Math.min(1, (top + EDGE - absY) / EDGE);
  if (absY > top + height - EDGE) return SPEED * Math.min(1, (absY - (top + height - EDGE)) / EDGE);
  return 0;
}

/**
 * A screen for dragging rows into the order you want them somewhere else — budgets on Budgets,
 * cards on Insights, categories in their folders.
 *
 * The drag runs on the UI thread (Reanimated): the order lives in a shared value while a finger is on
 * a grip, every row is placed from it — its top is the measured heights of the rows above it — and a
 * row pushed out of the way slides to its new place instead of jumping. React hears about the order
 * once, when the row is let go, so a drag costs no re-render per swap; the earlier version ran every
 * frame through JS and re-rendered the list at each swap, and lagged behind the finger for it. Rows
 * are as tall as their text needs (a description that wraps is not cut), measured as they lay out.
 *
 * `onDone` gets the whole order once, on Done, not per drag: one write, and Cancel really cancels.
 * The same goes for deleting: a row swiped left shows Delete, as in any iOS list, and a row deleted
 * leaves the list at once but is only gone once Done hands it to `onDone` in `removed`.
 *
 * The drag is a gesture-handler Pan on the grip: this screen is a card modal, a sheet with a vertical
 * swipe of its own, and only a real UIGestureRecognizer can tell UIKit's dismissal to stand aside.
 * Every screen using this is registered with `gestureEnabled: false` (app/_layout.tsx), and the
 * list's scroll is switched off while a row is in the hand, so nothing competes for the finger.
 *
 * A long list scrolls under the row being dragged: with the finger near the top or bottom edge the
 * list scrolls itself, a frame at a time (faster the closer it is), and the row stays under the finger
 * whichever of the two moved.
 *
 * With `section` rows, a row can never land above the first header (it has to belong to one), and
 * where it lands says which section it is in now — `onDone` reads that off the order.
 */
export function ReorderList({ title, items, hint, empty, onDone, onLongPress, keepInSection }: {
  title: string;
  /**
   * Rows stay in the section they started in: a row is dragged only among its own section's rows,
   * and only a header moves a section. For lists whose sections are kinds of thing rather than
   * folders — the budgets are one block on the Budgets screen, not something filed under Spending.
   */
  keepInSection?: boolean;
  items: ReorderItem[];
  hint: string;
  empty: { title: string; hint: string };
  onDone: (ids: string[], removed: string[]) => void;
  /**
   * A long press on a row that is not a header — for a move that would be a long drag ("Move to…").
   * It gets the order as it stands and a way to set a new one; nothing is written until Done.
   */
  onLongPress?: (id: string, order: string[], setOrder: (next: string[]) => void) => void;
}) {
  const sections = useMemo(() => Object.fromEntries(items.filter((x) => x.section).map((x) => [x.id, true])) as Record<string, boolean>, [items]);
  const sectioned = items.some((x) => x.section);

  // The order on the UI thread, and its copy here for Done, Delete and the long press.
  const order = useSharedValue<string[]>(items.map((x) => x.id));
  const orderRef = useRef<string[]>(order.value);
  const [removed, setRemoved] = useState<string[]>([]);
  const heights = useSharedValue<Record<string, number>>({});
  const hidden = useSharedValue<Record<string, boolean>>({});
  const placed = useDerivedValue(() => layout(order.value, heights.value, hidden.value));
  const drag = useSharedValue<Drag>({ id: "", top: 0, scroll: 0, min: 0, max: 0, ty: 0, absY: 0, blocks: {} });
  const dragTop = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const content = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // Rows slide only once something has moved: on opening they are placed, not flown in from a guess.
  const moving = useSharedValue(false);
  // The list's scroll is off while a row is in the hand: this is the one re-render a drag costs.
  const [holding, setHolding] = useState(false);

  const setOrder = useCallback((next: string[]) => { moving.set(true); orderRef.current = next; order.set(next); }, [order, moving]);
  const commit = () => { onDone(orderRef.current, removed); router.back(); };
  const del = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOrder(orderRef.current.filter((x) => x !== id));
    setRemoved((r) => [...r, id]);
  }, [setOrder]);
  /** Each swipeable row, so opening one closes the others, the way Mail and Reminders do. */
  const rowRefs = useRef(new Map<string, SwipeableMethods>());

  const dropped = useCallback((next: string[]) => { orderRef.current = next; setHolding(false); }, []);
  const tick = useCallback(() => { void Haptics.selectionAsync(); }, []);
  const lift = useCallback(() => { setHolding(true); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }, []);

  /** Put the row in the hand where the finger's travel, plus however far the list scrolled, takes it. */
  const follow = useCallback(() => {
    "worklet";
    const d = drag.value;
    if (!d.id) return;
    const top = d.top + d.ty + (scrollY.value - d.scroll);
    dragTop.set(top);
    const shown = order.value.filter((x) => !hidden.value[x]);
    const others = shown.filter((x) => x !== d.id);
    const center = top + (heights.value[d.id] ?? H) / 2;
    let k = 0, y = 0;
    for (const o of others) {
      const h = heights.value[o] ?? H;
      if (y + h / 2 < center) k++;
      y += h + GAP;
    }
    k = Math.min(d.max, Math.max(d.min, k));
    if (shown.indexOf(d.id) === k) return;
    const next = [...others.slice(0, k), d.id, ...others.slice(k)];
    order.set(Object.keys(d.blocks).length ? next.flatMap((x) => [x, ...(d.blocks[x] ?? [])]) : next);
    scheduleOnRN(tick);
  }, [drag, dragTop, scrollY, order, hidden, heights, tick]);

  const grab = useCallback((id: string) => {
    "worklet";
    let o = order.value;
    let blocks: Record<string, string[]> = {};
    if (sections[id]) {
      // A header carries its rows: they fold away under it while it is in the hand.
      const hide: Record<string, boolean> = {};
      let head = "";
      for (const x of o) {
        if (sections[x]) { head = x; blocks[x] = []; } else if (head) { blocks[head]!.push(x); hide[x] = true; }
      }
      hidden.set(hide);
    } else blocks = {};
    o = o.filter((x) => !hidden.value[x]);
    const at = o.indexOf(id);
    let min = 0, max = o.length - 1;
    if (!sections[id] && sectioned) {
      // A row belongs to a section: the first place it may go is just under the first header.
      // (`min`/`max` count the rows other than this one, so a header after it sits one place earlier.)
      min = o.findIndex((x) => sections[x]) + 1;
      if (keepInSection) {
        for (let i = at - 1; i >= 0; i--) if (sections[o[i]!]) { min = i + 1; break; }
        const next = o.findIndex((x, i) => i > at && sections[x]);
        max = next < 0 ? o.length - 1 : next - 1;
      }
    }
    const top = placed.value.tops[id] ?? 0;
    moving.set(true);
    drag.set({ id, top, scroll: scrollY.value, min, max, ty: 0, absY: 0, blocks });
    dragTop.set(top);
    scheduleOnRN(lift);
  }, [order, hidden, placed, drag, dragTop, scrollY, moving, sections, sectioned, keepInSection, lift]);

  const release = useCallback(() => {
    "worklet";
    if (!drag.value.id) return;
    drag.set({ ...drag.value, id: "", blocks: {} });
    hidden.set({});
    scheduleOnRN(dropped, order.value);
  }, [drag, hidden, order, dropped]);

  // Scrolling at the edges, a frame at a time, while a row is in the hand.
  useFrameCallback(() => {
    const d = drag.value;
    if (!d.id) return;
    const m = measure(scrollRef);
    if (!m) return;
    const v = speedAt(m.pageY, m.height, d.absY);
    if (!v) return;
    const next = Math.min(Math.max(0, content.value - m.height), Math.max(0, scrollY.value + v));
    if (next === scrollY.value) return;
    scrollY.set(next);
    scrollTo(scrollRef, 0, next, false);
    follow();
  });

  /**
   * One gesture per row, built for the list rather than per render: a `GestureDetector` handed a new
   * gesture object mid-drag has to rebuild its recognizer, and the drag goes with it. A few points of
   * travel are asked for before it activates, so a tap on the grip is still a tap, and a sideways
   * finger is the row's swipe to Delete.
   */
  // The lint rule takes the shared values these callbacks reach for as something read while rendering;
  // nothing here runs until a finger is on a grip.
  // eslint-disable-next-line react-hooks/refs
  const gestures = useMemo(() => new Map(items.map(({ id }) => [id, Gesture.Pan()
    .activeOffsetY([-4, 4])
    .failOffsetX([-12, 12])
    .onStart(() => { grab(id); })
    .onUpdate((e) => { drag.set({ ...drag.value, ty: e.translationY, absY: e.absoluteY }); follow(); })
    .onFinalize(() => { release(); })])), [items, grab, follow, release, drag]);

  const listStyle = useAnimatedStyle(() => ({ height: Math.max(0, placed.value.total - GAP) }));
  const count = items.length - removed.length;

  return (
    // The root view gesture-handler needs is put on here rather than around the whole app: these
    // are the only screens with a gesture, and a modal is its own view hierarchy anyway.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={title} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.done"), onPress: commit }} />
      <Animated.ScrollView ref={scrollRef} scrollEnabled={!holding} contentContainerStyle={{ padding: S.lg }} scrollEventThrottle={16}
        onScroll={(e) => { if (!holding) scrollY.set(e.nativeEvent.contentOffset.y); }}
        onContentSizeChange={(_w, h) => { content.set(h); }}>
        {count === 0 ? <Empty title={empty.title} hint={empty.hint} /> : <Text style={styles.hint}>{hint}</Text>}
        <Animated.View style={listStyle}>
          {items.map((row) => removed.includes(row.id) ? null : (
            <SortRow key={row.id} row={row} sectioned={sectioned} grip={gestures.get(row.id)!} placed={placed} hidden={hidden} drag={drag} dragTop={dragTop} moving={moving}
              onHeight={(h) => { heights.set({ ...heights.value, [row.id]: h }); }}
              holding={holding} onDelete={row.deletable ? () => del(row.id) : undefined}
              onLongPress={onLongPress && !row.section ? () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLongPress(row.id, orderRef.current, setOrder); } : undefined}
              swipeRef={(m) => { if (m) rowRefs.current.set(row.id, m); else rowRefs.current.delete(row.id); }}
              onSwipeOpen={() => { void Haptics.selectionAsync(); rowRefs.current.forEach((m, k) => { if (k !== row.id) m.close(); }); }} />
          ))}
        </Animated.View>
      </Animated.ScrollView>
    </GestureHandlerRootView>
  );
}

/** One row, placed by the shared order: it follows the finger while in the hand and slides everywhere else. */
function SortRow({ row, sectioned, grip, placed, hidden, drag, dragTop, moving, onHeight, holding, onDelete, onLongPress, swipeRef, onSwipeOpen }: {
  row: ReorderItem; sectioned: boolean; grip: ReturnType<typeof Gesture.Pan>;
  placed: SharedValue<{ tops: Record<string, number>; total: number }>; hidden: SharedValue<Record<string, boolean>>;
  drag: SharedValue<Drag>; dragTop: SharedValue<number>; moving: SharedValue<boolean>;
  onHeight: (h: number) => void; holding: boolean;
  onDelete?: () => void; onLongPress?: () => void;
  swipeRef: (m: SwipeableMethods | null) => void; onSwipeOpen: () => void;
}) {
  const { id } = row;
  const style = useAnimatedStyle(() => {
    const inHand = drag.value.id === id;
    const top = placed.value.tops[id] ?? 0;
    const y = inHand ? dragTop.value : moving.value ? withTiming(top, MOVE) : top;
    return {
      transform: [{ translateY: y }, { scale: withTiming(inHand ? 1.02 : 1, MOVE) }],
      opacity: withTiming(hidden.value[id] ? 0 : 1, MOVE),
      zIndex: inHand ? 10 : 0,
      shadowOpacity: withTiming(inHand ? 0.22 : 0, MOVE),
    };
  });
  const content = (
    <Pressable style={[styles.rowInner, row.section && styles.sectionInner]} disabled={!onLongPress || holding} delayLongPress={350} onLongPress={onLongPress}>
      {row.icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.name, row.section && styles.sectionName]}>{row.title}</Text>
        {row.subtitle ? <Text style={styles.sub}>{row.subtitle}</Text> : null}
      </View>
      <GestureDetector gesture={grip}>
        <View style={styles.grip} accessibilityRole="adjustable" accessibilityLabel={t("ui.reorderA11y", { title: row.title })}>
          <SymbolView name="line.3.horizontal" size={18} tintColor={C.tertiary} />
        </View>
      </GestureDetector>
    </Pressable>
  );
  return (
    <Animated.View onLayout={(e: LayoutChangeEvent) => onHeight(Math.round(e.nativeEvent.layout.height))}
      style={[styles.row, row.section && styles.sectionRow, sectioned && !row.section && styles.inSection, style]}
      accessibilityActions={onDelete ? [{ name: "delete", label: t("common.delete") }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "delete") onDelete?.(); }}>
      {onDelete ? (
        <ReanimatedSwipeable friction={1.6} rightThreshold={40} overshootRight={false} enabled={!holding} containerStyle={styles.swipe}
          ref={swipeRef} onSwipeableWillOpen={onSwipeOpen}
          renderRightActions={() => (
            <Pressable onPress={onDelete} style={({ pressed }) => [styles.delete, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t("ui.reorderDeleteA11y", { title: row.title })}>
              <SymbolView name="trash" size={18} tintColor="#FFFFFF" />
              <ButtonText style={styles.deleteText}>{t("common.delete")}</ButtonText>
            </Pressable>
          )}>
          {content}
        </ReanimatedSwipeable>
      ) : content}
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  hint: { color: C.secondary, fontSize: 13, paddingBottom: S.sm },
  // Placed by translateY from the top of the list (see `layout`), so every row starts at 0.
  row: { position: "absolute", top: 0, left: 0, right: 0, borderRadius: R.card, backgroundColor: C.card, shadowColor: "#000", shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  rowInner: { minHeight: H, flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, paddingVertical: S.sm, backgroundColor: C.card, borderRadius: R.card },
  // Clipped to the row's corners, so Delete comes out from under the row rather than beside it.
  swipe: { borderRadius: R.card, overflow: "hidden", backgroundColor: C.red },
  delete: { width: 88, flex: 1, backgroundColor: C.red, alignItems: "center", justifyContent: "center", gap: 2 },
  deleteText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  name: { fontSize: 17, color: C.label },
  sectionName: { fontWeight: "700" },
  // A header reads as one by its weight and its tint; the rows under one are stepped in.
  sectionRow: { backgroundColor: C.fill },
  sectionInner: { backgroundColor: "transparent" },
  inSection: { left: S.xl },
  sub: { fontSize: 13, color: C.secondary },
  grip: { paddingHorizontal: S.sm, paddingVertical: S.md, minHeight: 44, justifyContent: "center" },
}));
