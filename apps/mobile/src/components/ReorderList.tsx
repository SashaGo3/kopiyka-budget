import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { animateNextLayout } from "@/lib/motion";
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from "react-native-gesture-handler";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { Empty, ModalHeader } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Every row the same height and the same gap below it, which is what lets a drag be arithmetic rather
 * than a measurement. The arithmetic counts the whole pitch — row plus gap — and nothing else may add
 * space between rows (a header's extra margin once did): every point not counted is a point the drop
 * drifts from the finger, row after row.
 */
const H = 52;
const GAP = 4;
const PITCH = H + GAP;
/** How close to the list's top or bottom edge the finger has to be before the list scrolls under it. */
const EDGE = 90;
/** The fastest it scrolls, in points a frame, with the finger right at the edge. */
const SPEED = 14;

/** How fast to scroll for a finger at screen `absY` over a list at `top`, `height` tall: negative up, positive down, 0 away from the edges. */
function speedAt({ top, height }: { top: number; height: number }, absY: number): number {
  if (!height) return 0;
  if (absY < top + EDGE) return -SPEED * Math.min(1, (top + EDGE - absY) / EDGE);
  if (absY > top + height - EDGE) return SPEED * Math.min(1, (absY - (top + height - EDGE)) / EDGE);
  return 0;
}

/** `deletable` rows can be swiped left to reveal Delete; a row standing for a whole section cannot. */
export type ReorderItem = { id: string; title: string; subtitle?: string; icon?: ReactNode; deletable?: boolean;
  /**
   * A header that the rows after it, up to the next header, belong to (categories under their folder).
   * A row can be dragged into another section; a header carries its whole section with it — while one
   * is in the hand the list folds to headers only, and unfolds where it is dropped.
   */
  section?: boolean };

/**
 * A screen for dragging rows into the order you want them somewhere else — budgets on Budgets,
 * cards on Insights.
 *
 * A screen of its own, and rows of one fixed height, deliberately: the cards these rows stand for
 * change height as the month goes on, and dragging cards of unknown height inside a scrolling list
 * is a lot of machinery to get something that still fights the scroll. Here each one is a row, the
 * drag is by the grip on the right (so the list itself still scrolls normally under a finger
 * anywhere else), and where a row lands is `round(dy / H)` away from where it started.
 *
 * `onDone` gets the whole order once, on Done, not per drag: one write, and Cancel really cancels.
 * The same goes for deleting: a row swiped left shows Delete, as in any iOS list, and a row deleted
 * leaves the list at once but is only gone once Done hands it to `onDone` in `removed`.
 *
 * The drag is a gesture-handler Pan rather than a `PanResponder`. This screen is a card modal, and
 * a card modal on iOS is a sheet with a vertical swipe of its own: React Native's responder system
 * is a JS layer above one touch handler, so it cannot tell UIKit's dismissal gesture to stand
 * aside, and dragging a row simply dragged the sheet towards the floor. A gesture-handler Pan is a
 * real UIGestureRecognizer, which can — it blocks the list's scroll while it runs, and every screen
 * using this is registered with `gestureEnabled: false` (app/_layout.tsx) so the sheet stops
 * competing for the same downward finger. Cancel and Done are how this screen is left.
 *
 * The callbacks are `.runOnJS(true)`: the work they do — swapping ids in an array, a haptic,
 * React state — is JS work anyway, and this way the file needs no worklets to read.
 *
 * A long list scrolls under the row being dragged: with the finger near the top or bottom edge the
 * list scrolls itself (faster the closer it is), and where the row lands is measured in the list's own
 * coordinates — the finger's travel plus how far the list has scrolled since the grab — so the row
 * stays under the finger whichever of the two moved.
 *
 * With `section` rows, a row can never land above the first header (it has to belong to one), and
 * where it lands says which section it is in now — `onDone` reads that off the order.
 */
export function ReorderList({ title, items, hint, empty, onDone, onLongPress }: {
  title: string;
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
  const byId = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);
  const [order, setOrder] = useState<string[]>(() => items.map((x) => x.id));
  // The live copy the gesture works on: a pan updates it many times a frame, and reading it back
  // out of React state would be a frame behind the finger every time.
  const orderRef = useRef(order);
  const setOrderBoth = useCallback((next: string[]) => { orderRef.current = next; setOrder(next); }, []);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pan] = useState(() => new Animated.Value(0));

  const [removed, setRemoved] = useState<string[]>([]);
  const sectioned = useMemo(() => items.some((x) => x.section), [items]);
  const commit = () => { onDone(orderRef.current, removed); router.back(); };
  const del = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateNextLayout();
    setOrderBoth(orderRef.current.filter((x) => x !== id));
    setRemoved((r) => [...r, id]);
  }, [setOrderBoth]);
  /** Each swipeable row, so opening one closes the others, the way Mail and Reminders do. */
  const rowRefs = useRef(new Map<string, SwipeableMethods>());

  /**
   * Where the dragged row started and where it has got to, in refs rather than in the closure: every
   * swap re-renders, and a baseline that lived in the render would be reset to zero half way through
   * the gesture — the row would jump back under the finger and the next swap would be measured from
   * the wrong place.
   */
  const from = useRef({ index: 0, at: 0 });
  // The list as the drag sees it: where it is scrolled to (and was at the grab), its size and place
  // on screen, and the finger's last travel and screen position — read again every frame it scrolls.
  const scrollRef = useRef<ScrollView>(null);
  const frame = useRef<View>(null);
  const live = useRef({ y: 0, start: 0, top: 0, height: 0, content: 0, ty: 0, absY: 0, raf: null as number | null });
  /** While a header is in the hand: each header's rows, put back under it on drop. */
  const folded = useRef<Map<string, string[]> | null>(null);
  const grab = useCallback((id: string) => {
    if (byId.get(id)?.section) {
      const blocks = new Map<string, string[]>();
      let head: string | null = null;
      const before: string[] = [];
      for (const x of orderRef.current) {
        if (byId.get(x)?.section) { head = x; blocks.set(x, []); } else if (head) blocks.get(head)!.push(x); else before.push(x);
      }
      folded.current = blocks;
      animateNextLayout();
      setOrderBoth([...before, ...blocks.keys()]);
    }
    const at = orderRef.current.indexOf(id);
    from.current = { index: at, at };
    live.current.start = live.current.y;
    frame.current?.measureInWindow((_x, top, _w, height) => { live.current.top = top; live.current.height = height; });
    pan.setValue(0);
    setDragId(id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [pan, byId, setOrderBoth]);
  /** Put the row where `ty` of finger travel, plus however far the list has scrolled, takes it. */
  const place = useCallback((ty: number) => {
    const dy = ty + (live.current.y - live.current.start);
    const { index, at } = from.current;
    // A row belongs to a section: the first place it may go is just under the first header.
    const first = folded.current ? 0 : orderRef.current.findIndex((x) => byId.get(x)?.section) + 1;
    const target = Math.min(orderRef.current.length - 1, Math.max(first, index + Math.round(dy / PITCH)));
    if (target !== at) {
      const next = [...orderRef.current];
      next.splice(target, 0, ...next.splice(at, 1));
      from.current = { index, at: target };
      setOrderBoth(next);
      void Haptics.selectionAsync();
    }
    // The row has moved `(at − index)` places in the list already, so only what is left of the
    // finger's travel is drawn as an offset — otherwise it would run away by a row each swap.
    pan.setValue(dy - (from.current.at - index) * PITCH);
  }, [pan, setOrderBoth, byId]);
  const stopScrolling = useCallback(() => { if (live.current.raf != null) cancelAnimationFrame(live.current.raf); live.current.raf = null; }, []);
  // Scrolling at the edge, a frame at a time, placing the row again for each new offset; it keeps going
  // for as long as the finger stays near the edge and there is list left to scroll.
  const startScrolling = useCallback(() => {
    const tick = () => {
      const l = live.current;
      const v = speedAt(l, l.absY);
      const next = Math.min(Math.max(0, l.content - l.height), Math.max(0, l.y + v));
      if (!v || next === l.y) { l.raf = null; return; }
      l.y = next;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      place(l.ty);
      l.raf = requestAnimationFrame(tick);
    };
    live.current.raf = requestAnimationFrame(tick);
  }, [place]);
  const drag = useCallback((ty: number, absY: number) => {
    live.current.ty = ty; live.current.absY = absY;
    place(ty);
    if (live.current.raf == null && speedAt(live.current, absY)) startScrolling();
  }, [place, startScrolling]);
  useEffect(() => stopScrolling, [stopScrolling]);
  const drop = useCallback(() => {
    stopScrolling();
    const blocks = folded.current;
    if (blocks) {
      folded.current = null;
      animateNextLayout();
      setOrderBoth(orderRef.current.flatMap((x) => [x, ...(blocks.get(x) ?? [])]));
    }
    setDragId(null); pan.setValue(0);
  }, [pan, setOrderBoth, stopScrolling]);
  // The list's own scrolling, as a gesture the drag can name. A `Native` gesture wrapped round the
  // ScrollView is the handle gesture-handler gives you onto a native scroll: without one there is
  // nothing for `blocksExternalGesture` to point at.
  const scrolling = useMemo(() => Gesture.Native(), []);
  /**
   * One gesture per row, built for the list rather than per render: a `GestureDetector` handed a
   * new gesture object mid-drag has to rebuild its recognizer, and the drag goes with it. Dragging
   * re-renders this screen on every swap, so the map is rebuilt only when the rows themselves
   * change. The callbacks are safe to close over: each reads the live order through a ref.
   *
   * The grip owns the drag — `blocksExternalGesture` makes the list wait for it, so a finger
   * anywhere else still scrolls normally — and a few pixels of travel are asked for before it
   * activates, so a tap that lands on the grip is still a tap.
   *
   * The lint rule below sees the refs those callbacks reach for and takes them for something read
   * while rendering. They are not: nothing here runs until a finger is on the grip.
   */
  // eslint-disable-next-line react-hooks/refs
  const gestures = useMemo(() => new Map(items.map(({ id }) => [id, Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-4, 4])
    // A sideways finger on the grip is the row's swipe to Delete, not a drag.
    .failOffsetX([-12, 12])
    .blocksExternalGesture(scrolling)
    .onStart(() => grab(id))
    .onUpdate((e) => drag(e.translationY, e.absoluteY))
    .onFinalize(drop)])), [items, scrolling, grab, drag, drop]);

  return (
    // The root view gesture-handler needs is put on here rather than around the whole app: these
    // are the only screens with a gesture, and a modal is its own view hierarchy anyway.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={title} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.done"), onPress: commit }} />
      <GestureDetector gesture={scrolling}>
        <View ref={frame} collapsable={false} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} scrollEnabled={!dragId} contentContainerStyle={{ padding: S.lg, gap: 0 }} scrollEventThrottle={16}
          onScroll={(e) => { if (live.current.raf == null) live.current.y = e.nativeEvent.contentOffset.y; }}
          onLayout={(e) => { live.current.height = e.nativeEvent.layout.height; }}
          onContentSizeChange={(_w, h) => { live.current.content = h; }}>
          {order.length === 0 ? <Empty title={empty.title} hint={empty.hint} /> : null}
          {order.length ? <Text style={styles.hint}>{hint}</Text> : null}
          {order.map((id) => {
            const row = byId.get(id), grip = gestures.get(id);
            if (!row || !grip) return null;
            const dragging = dragId === id;
            const content = (
              <Pressable style={[styles.rowInner, row.section && styles.sectionInner]} disabled={!onLongPress || row.section || !!dragId} delayLongPress={350}
                onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLongPress?.(id, orderRef.current, (next) => { animateNextLayout(); setOrderBoth(next); }); }}>
                {row.icon}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, row.section && styles.sectionName]} numberOfLines={1}>{row.title}</Text>
                  {row.subtitle ? <Text style={styles.sub} numberOfLines={1}>{row.subtitle}</Text> : null}
                </View>
                <GestureDetector gesture={grip}>
                  <View style={styles.grip} accessibilityRole="adjustable" accessibilityLabel={t("ui.reorderA11y", { title: row.title })}>
                    <SymbolView name="line.3.horizontal" size={18} tintColor={C.tertiary} />
                  </View>
                </GestureDetector>
              </Pressable>
            );
            return (
              <Animated.View key={id} style={[styles.row, row.section && styles.sectionRow, sectioned && !row.section && styles.inSection, dragging && styles.dragging, dragging && { transform: [{ translateY: pan }] }]}
                accessibilityActions={row.deletable ? [{ name: "delete", label: t("common.delete") }] : undefined}
                onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "delete") del(id); }}>
                {row.deletable ? (
                  <ReanimatedSwipeable friction={1.6} rightThreshold={40} overshootRight={false} enabled={!dragId} containerStyle={styles.swipe}
                    simultaneousWithExternalGesture={scrolling}
                    ref={(m) => { if (m) rowRefs.current.set(id, m); else rowRefs.current.delete(id); }}
                    onSwipeableWillOpen={() => { void Haptics.selectionAsync(); rowRefs.current.forEach((m, k) => { if (k !== id) m.close(); }); }}
                    renderRightActions={() => (
                      <Pressable onPress={() => del(id)} style={({ pressed }) => [styles.delete, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t("ui.reorderDeleteA11y", { title: row.title })}>
                        <SymbolView name="trash" size={18} tintColor="#FFFFFF" />
                        <Text style={styles.deleteText}>{t("common.delete")}</Text>
                      </Pressable>
                    )}>
                    {content}
                  </ReanimatedSwipeable>
                ) : content}
              </Animated.View>
            );
          })}
        </ScrollView>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = themed(() => StyleSheet.create({
  hint: { color: C.secondary, fontSize: 13, paddingBottom: S.sm },
  row: { height: H, marginBottom: GAP, borderRadius: R.card, backgroundColor: C.card },
  rowInner: { height: H, flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, backgroundColor: C.card, borderRadius: R.card },
  // Clipped to the row's corners, so Delete comes out from under the row rather than beside it.
  swipe: { borderRadius: R.card, overflow: "hidden", backgroundColor: C.red },
  delete: { width: 88, height: H, backgroundColor: C.red, alignItems: "center", justifyContent: "center", gap: 2 },
  deleteText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  // Lifted off the list while it is in the hand, and drawn last so it passes over its neighbours.
  dragging: { zIndex: 10, elevation: 6, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  name: { fontSize: 16, color: C.label },
  sectionName: { fontWeight: "700" },
  // A header reads as one by its weight and its tint, not by extra space (see PITCH); the rows under
  // one are stepped in.
  sectionRow: { backgroundColor: C.fill },
  sectionInner: { backgroundColor: "transparent" },
  inSection: { marginLeft: S.xl },
  sub: { fontSize: 13, color: C.secondary },
  grip: { paddingHorizontal: S.sm, paddingVertical: S.md },
}));
