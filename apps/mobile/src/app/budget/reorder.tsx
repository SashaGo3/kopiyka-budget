import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from "react-native-gesture-handler";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { activeBudgets, budgetCategoryIds, formatMinor, getRow, save, type Budget } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { CategoryIcon, Empty, ModalHeader } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { budgetTitle, nameMaps } from "@/lib/budgetName";
import { getBudgetScope } from "@/lib/settings";
import { scopeAccount } from "@/lib/scope";
import { todayLocal } from "@/lib/dates";

/** Every row the same height, which is what lets a drag be arithmetic rather than a measurement. */
const H = 60;

/**
 * Drag the budgets into the order you want them on the Budgets screen.
 *
 * A screen of its own, and rows of one fixed height, deliberately: a budget card on the Budgets
 * screen is as tall as the number of categories spent in this month, so it changes height as the
 * month goes on, and dragging cards of unknown height inside a scrolling list is a lot of
 * machinery to get something that still fights the scroll. Here each budget is one row, the drag
 * is by the grip on the right (so the list itself still scrolls normally under a finger anywhere
 * else), and where a row lands is `round(dy / H)` away from where it started.
 *
 * `sort` is written for every budget on Done, not per drag: one write, and Cancel really cancels.
 *
 * The drag is a gesture-handler Pan rather than a `PanResponder`. This screen is a card modal, and
 * a card modal on iOS is a sheet with a vertical swipe of its own: React Native's responder system
 * is a JS layer above one touch handler, so it cannot tell UIKit's dismissal gesture to stand
 * aside, and dragging a row simply dragged the sheet towards the floor. A gesture-handler Pan is a
 * real UIGestureRecognizer, which can — it blocks the list's scroll while it runs, and the screen
 * is registered with `gestureEnabled: false` (app/_layout.tsx) so the sheet stops competing for
 * the same downward finger. Cancel and Done are how this screen is left.
 *
 * The callbacks are `.runOnJS(true)`: the work they do — swapping ids in an array, a haptic,
 * React state — is JS work anyway, and this way the file needs no worklets to read.
 */
export default function BudgetReorder() {
  const budgets = useQuery((d) => {
    const names = nameMaps(d);
    return activeBudgets(d, todayLocal(), scopeAccount(getBudgetScope())).map((b) => ({
      b, title: budgetTitle(b, names),
      icon: iconOf(b, d),
    }));
  });
  const byId = useMemo(() => new Map(budgets.map((x) => [x.b.id, x])), [budgets]);
  const [order, setOrder] = useState<string[]>(() => budgets.map((x) => x.b.id));
  // The live copy the gesture works on: a pan updates it many times a frame, and reading it back
  // out of React state would be a frame behind the finger every time.
  const orderRef = useRef(order);
  const setOrderBoth = useCallback((next: string[]) => { orderRef.current = next; setOrder(next); }, []);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pan] = useState(() => new Animated.Value(0));

  const commit = () => {
    const ids = orderRef.current;
    mutate((d) => ids.forEach((id, i) => { const b = getRow(d, "budgets", id); if (b && b.sort !== i) save(d, "budgets", { ...b, sort: i } as Budget); }));
    router.back();
  };

  /**
   * Where the dragged row started and where it has got to, in refs rather than in the closure: every
   * swap re-renders, and a baseline that lived in the render would be reset to zero half way through
   * the gesture — the row would jump back under the finger and the next swap would be measured from
   * the wrong place.
   */
  const from = useRef({ index: 0, at: 0 });
  const grab = useCallback((id: string) => {
    const at = orderRef.current.indexOf(id);
    from.current = { index: at, at };
    pan.setValue(0);
    setDragId(id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [pan]);
  const drag = useCallback((dy: number) => {
    const { index, at } = from.current;
    const target = Math.min(orderRef.current.length - 1, Math.max(0, index + Math.round(dy / H)));
    if (target !== at) {
      const next = [...orderRef.current];
      next.splice(target, 0, ...next.splice(at, 1));
      from.current = { index, at: target };
      setOrderBoth(next);
      void Haptics.selectionAsync();
    }
    // The row has moved `(at − index)` places in the list already, so only what is left of the
    // finger's travel is drawn as an offset — otherwise it would run away by a row each swap.
    pan.setValue(dy - (from.current.at - index) * H);
  }, [pan, setOrderBoth]);
  const drop = useCallback(() => { setDragId(null); pan.setValue(0); }, [pan]);
  // The list's own scrolling, as a gesture the drag can name. A `Native` gesture wrapped round the
  // ScrollView is the handle gesture-handler gives you onto a native scroll: without one there is
  // nothing for `blocksExternalGesture` to point at.
  const scrolling = useMemo(() => Gesture.Native(), []);
  /**
   * One gesture per budget, built for the list rather than per render: a `GestureDetector` handed a
   * new gesture object mid-drag has to rebuild its recognizer, and the drag goes with it. Dragging
   * re-renders this screen on every swap, so the map is rebuilt only when the budgets themselves
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
  const gestures = useMemo(() => new Map(budgets.map(({ b }) => [b.id, Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-4, 4])
    .blocksExternalGesture(scrolling)
    .onStart(() => grab(b.id))
    .onUpdate((e) => drag(e.translationY))
    .onFinalize(drop)])), [budgets, scrolling, grab, drag, drop]);

  return (
    // The root view gesture-handler needs is put on here rather than around the whole app: this is
    // the only screen with a gesture, and a modal is its own view hierarchy anyway.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title="Reorder budgets" left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Done", onPress: commit }} />
      <GestureDetector gesture={scrolling}>
        <ScrollView scrollEnabled={!dragId} contentContainerStyle={{ padding: S.lg, gap: 0 }}>
          {order.length === 0 ? <Empty title="No budgets" hint="Add one on the Budgets screen first." /> : null}
          {order.length ? <Text style={styles.hint}>Drag by the grip on the right. The order here is the order on Budgets.</Text> : null}
          {order.map((id) => {
            const row = byId.get(id), grip = gestures.get(id);
            if (!row || !grip) return null;
            const dragging = dragId === id;
            return (
              <Animated.View key={id} style={[styles.row, dragging && styles.dragging, dragging && { transform: [{ translateY: pan }] }]}>
                <CategoryIcon name={row.title} icon={row.icon?.icon ?? null} color={row.icon?.color ?? null} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {formatMinor(row.b.amount_minor, row.b.currency)} {row.b.currency}{row.b.in_planned === 0 ? " · not in Planned" : ""}
                  </Text>
                </View>
                <GestureDetector gesture={grip}>
                  <View style={styles.grip} accessibilityRole="adjustable" accessibilityLabel={`Reorder ${row.title}`}>
                    <SymbolView name="line.3.horizontal" size={18} tintColor={C.tertiary} />
                  </View>
                </GestureDetector>
              </Animated.View>
            );
          })}
        </ScrollView>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** The icon a budget wears in a list: its single category's, or nothing when it covers several. */
function iconOf(b: Budget, d: Parameters<typeof getRow>[0]): { icon: string | null; color: string | null } | null {
  const ids = budgetCategoryIds(b);
  if (b.tag_id || ids.length !== 1) return null;
  const c = getRow(d, "categories", ids[0]!);
  return c ? { icon: c.icon, color: c.color } : null;
}

const styles = StyleSheet.create({
  hint: { color: C.secondary, fontSize: 13, paddingBottom: S.sm },
  row: { height: H, flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, backgroundColor: C.card, borderRadius: R.card, marginBottom: S.xs },
  // Lifted off the list while it is in the hand, and drawn last so it passes over its neighbours.
  dragging: { zIndex: 10, elevation: 6, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  name: { fontSize: 16, color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  grip: { paddingHorizontal: S.sm, paddingVertical: S.md },
});
