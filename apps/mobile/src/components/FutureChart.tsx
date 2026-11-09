import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { StyleSheet, Text, View, type ColorValue, type LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { currencyDecimals, numberFormat } from "@kopiyka/core";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Small charts for the Purrphecy screen and the savings goal: lines (`LineChart`) for paths that are
 * compared, stacked columns (`StackChart`) for a total made of parts — what you put in, and what grew.
 *
 * Plain views, no drawing library (nothing native to link or start at launch), built to stay cheap:
 * - **Few views.** A line is drawn through at most `MAX_DRAWN` points whatever its length (a 50-year
 *   series is thinned; the readout still reads every year), and its wash is one strip per segment.
 * - **Touch never re-renders the chart.** The finger is a gesture on the UI thread moving a shared
 *   value; the rule, the dots and the highlight follow it as animated styles. JS hears only when the
 *   point under the finger *changes*, and only the readout line re-renders then.
 * - **One animation per chart.** Lines are revealed by a single clip, columns grow by a single scale;
 *   a slider dragged afterwards redraws them directly, with nothing to animate.
 * Reduce Motion shows them whole at once.
 */

/** No line is drawn through more points than this; the data behind it keeps every point. */
const MAX_DRAWN = 24;

/** "1.2M", "350k" — an axis label, not an amount; amounts go through `formatMinor`. */
export function compactMinor(minor: number, currency?: string): string {
  const major = Math.abs(minor) / 10 ** (currency ? currencyDecimals(currency) : 2);
  const sign = minor < 0 ? "−" : "";
  const dec = numberFormat().decimal;
  const one = (x: number) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, "").replace(".", dec));
  if (major >= 1e6) return sign + t("future.compact.million", { n: one(major / 1e6) });
  if (major >= 1e3) return sign + t("future.compact.thousand", { n: one(major / 1e3) });
  return sign + String(Math.round(major));
}

/** The indices a line is drawn through: all of them when few, else evenly thinned, always both ends. */
function drawn(len: number): number[] {
  if (len <= MAX_DRAWN) return Array.from({ length: len }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < MAX_DRAWN; k++) out.push(Math.round((k * (len - 1)) / (MAX_DRAWN - 1)));
  return [...new Set(out)];
}

/**
 * A finger on the chart, on the UI thread: a horizontal drag (a vertical one is left to the page's
 * scroll) or a tap moves `pos` to the nearest point, and `onIndex` runs on JS only when it changes.
 */
function useScrub(n: number, width: number, onIndex: (i: number) => void) {
  const pos = useSharedValue(-1);
  const pick = (x: number) => {
    "worklet";
    if (!width || n < 1) return;
    const i = Math.max(0, Math.min(n - 1, Math.round((x / width) * (n - 1))));
    if (i !== pos.get()) { pos.set(i); scheduleOnRN(onIndex, i); }
  };
  const pan = Gesture.Pan().activeOffsetX([-6, 6]).failOffsetY([-12, 12]).onStart((e) => pick(e.x)).onUpdate((e) => pick(e.x));
  const tap = Gesture.Tap().onEnd((e) => pick(e.x));
  return { pos, gesture: Gesture.Race(pan, tap) };
}

/** The line above a chart saying what is under the finger; the only part that re-renders on touch. */
function Readout({ ref, n, describe }: { ref: Ref<{ show: (i: number) => void }>; n: number; describe: (i: number) => string }) {
  const [at, setAt] = useState<number | null>(null);
  useImperativeHandle(ref, () => ({ show: setAt }), []);
  const i = at !== null && at < n ? at : null;
  return <Text style={[styles.pickLine, i === null && { color: C.secondary }]} numberOfLines={2}>{n ? describe(i ?? n - 1) : " "}</Text>;
}

/** Everything a chart shares: the readout's channel, the haptic, the VoiceOver steps. */
function useChartTouch(n: number, width: number) {
  const api = useRef<{ show: (i: number) => void } | null>(null);
  const current = useRef<number | null>(null);
  const onIndex = (i: number) => { current.current = i; void Haptics.selectionAsync(); api.current?.show(i); };
  const { pos, gesture } = useScrub(n, width, onIndex);
  const step = (d: 1 | -1) => {
    const i = Math.max(0, Math.min(n - 1, (current.current ?? n - 1) + d));
    pos.set(i);
    onIndex(i);
  };
  return { api, pos, gesture, a11y: {
    accessible: true, accessibilityRole: "adjustable" as const,
    accessibilityActions: [{ name: "increment" }, { name: "decrement" }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => step(e.nativeEvent.actionName === "increment" ? 1 : -1),
  } };
}

export interface LineSeries {
  key: string;
  color: ColorValue;
  values: number[];
  dashed?: boolean;
  /** A wash under the line, down to the axis. */
  fill?: boolean;
  width?: number;
  /** Where on the x axis the first value sits: a projection that carries on from where history ends. */
  offset?: number;
}

/** The dot that rides a series under the finger. */
function Dot({ pos, xs, ys, offset, color }: { pos: SharedValue<number>; xs: number[]; ys: number[]; offset: number; color: ColorValue }) {
  const style = useAnimatedStyle(() => {
    const k = pos.value - offset;
    const on = pos.value >= 0 && k >= 0 && k < ys.length;
    return { opacity: on ? 1 : 0, transform: [{ translateX: (xs[pos.value] ?? 0) - 4 }, { translateY: (on ? ys[k]! : 0) - 4 }] };
  });
  return <Animated.View pointerEvents="none" style={[styles.dot, { borderColor: color }, style]} />;
}

function Rule({ pos, xs, height }: { pos: SharedValue<number>; xs: number[]; height: number }) {
  const style = useAnimatedStyle(() => ({ opacity: pos.value >= 0 ? 0.6 : 0, transform: [{ translateX: xs[pos.value] ?? 0 }] }));
  return <Animated.View pointerEvents="none" style={[styles.rule, { height }, style]} />;
}

export function LineChart({ series, height = 120, describe, startLabel, endLabel, target, interactive = true, legend, currency }: {
  series: LineSeries[];
  height?: number;
  /** What the point at `i` is, for the line above the chart; the last point when nothing is touched. */
  describe?: (i: number) => string;
  startLabel?: string;
  endLabel?: string;
  /** A level drawn across the chart: a goal, a freedom number. */
  target?: { minor: number; color?: ColorValue; label?: string };
  interactive?: boolean;
  legend?: ReactNode;
  /** For the axis label's units; amounts are minor units of it. */
  currency?: string;
}) {
  const [w, setW] = useState(0);
  const n = Math.max(0, ...series.map((s) => s.values.length + (s.offset ?? 0)));
  const { api, pos, gesture, a11y } = useChartTouch(n, w);
  const reduced = useReducedMotion();
  const shown = useSharedValue(reduced ? 1 : 0);
  const has = w > 0;
  useEffect(() => {
    if (has && !reduced) shown.set(withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [has, reduced, shown]);
  const reveal = useAnimatedStyle(() => ({ width: w * shown.value }), [w]);

  const all = series.flatMap((s) => s.values).concat(target ? [target.minor] : []);
  const max = Math.max(1, ...all), top = max * 1.05, bottom = Math.min(0, ...all);
  const y = (v: number) => height - ((v - bottom) / (top - bottom)) * height;
  const xs = Array.from({ length: n }, (_, i) => (n > 1 ? (i / (n - 1)) * w : 0));
  const base = y(Math.max(bottom, 0));

  // The drawing: rebuilt when the data or the size changes (the React Compiler memoises it), never on touch.
  const lines = !w ? null : series.flatMap((s) => {
    const out: ReactNode[] = [];
    const th = s.width ?? 2;
    const o = s.offset ?? 0;
    const idx = drawn(s.values.length);
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1]!, b = idx[k]!;
      const x1 = xs[o + a]!, y1 = y(s.values[a]!), x2 = xs[o + b]!, y2 = y(s.values[b]!);
      if (s.fill) {
        const mid = (y1 + y2) / 2;
        out.push(<View key={`${s.key}f${k}`} style={{ position: "absolute", left: x1, width: x2 - x1 + 0.5, top: Math.min(mid, base), height: Math.abs(base - mid), backgroundColor: s.color, opacity: 0.12 }} />);
      }
      const len = Math.hypot(x2 - x1, y2 - y1), angle = Math.atan2(y2 - y1, x2 - x1);
      out.push(<View key={`${s.key}${k}`} style={[{ position: "absolute", left: (x1 + x2) / 2 - len / 2 - 0.5, top: (y1 + y2) / 2 - th / 2, width: len + 1, transform: [{ rotate: `${angle}rad` }] },
        s.dashed ? { height: 0, borderTopWidth: th, borderStyle: "dashed", borderColor: s.color } : { height: th, borderRadius: th / 2, backgroundColor: s.color }]} />);
    }
    return out;
  });

  const chart = (
    <View style={{ height }} onLayout={(e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width))} {...(interactive ? a11y : {})}>
      <View style={[styles.grid, { top: y(max) }]} />
      <Text style={[styles.axisMax, { top: y(max) + 2 }]}>{compactMinor(max, currency)}</Text>
      {target ? <View style={[styles.target, { top: y(target.minor), borderColor: target.color ?? C.label }]} /> : null}
      {target?.label ? <Text style={[styles.targetLabel, { top: y(target.minor) - 15, color: target.color ?? C.label }]} numberOfLines={1}>{target.label}</Text> : null}
      <Animated.View style={[styles.clip, { height }, reveal]} pointerEvents="none">
        <View style={{ width: w, height }}>{lines}</View>
      </Animated.View>
      {interactive && w ? <>
        <Rule pos={pos} xs={xs} height={height} />
        {series.map((s) => <Dot key={s.key} pos={pos} xs={xs} ys={s.values.map(y)} offset={s.offset ?? 0} color={s.color} />)}
      </> : null}
    </View>
  );
  return (
    <View style={styles.box}>
      {describe ? <Readout ref={api} n={n} describe={describe} /> : null}
      {interactive ? <GestureHandlerRootView><GestureDetector gesture={gesture}>{chart}</GestureDetector></GestureHandlerRootView> : chart}
      {startLabel || endLabel ? <View style={styles.axis}><Text style={styles.axisText}>{startLabel ?? ""}</Text><Text style={styles.axisText}>{endLabel ?? ""}</Text></View> : null}
      {legend}
    </View>
  );
}

/** The band behind the column under the finger. */
function Highlight({ pos, n, w }: { pos: SharedValue<number>; n: number; w: number }) {
  const col = n ? w / n : 0;
  const style = useAnimatedStyle(() => ({ opacity: pos.value >= 0 ? 1 : 0, transform: [{ translateX: Math.max(0, pos.value) * col }] }));
  return <Animated.View pointerEvents="none" style={[styles.band, { width: col }, style]} />;
}

export function StackChart({ stacks, colors, height = 120, describe, startLabel, endLabel, target, legend, currency }: {
  /** Each column's parts, bottom first, aligned with `colors`. */
  stacks: number[][];
  colors: ColorValue[];
  height?: number;
  describe?: (i: number) => string;
  startLabel?: string;
  endLabel?: string;
  target?: { minor: number; color?: ColorValue; label?: string };
  legend?: ReactNode;
  currency?: string;
}) {
  const [w, setW] = useState(0);
  const n = stacks.length;
  const { api, pos, gesture, a11y } = useChartTouch(n, w);
  const reduced = useReducedMotion();
  const grow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) grow.set(withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [reduced, grow]);
  const growStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.value }] }));
  const peak = Math.max(1, ...stacks.map((s) => s.reduce((a, b) => a + Math.max(0, b), 0)), target?.minor ?? 0);
  const scale = height / (peak * 1.05);
  const gap = n > 30 ? 1 : n > 15 ? 2 : 3;
  return (
    <View style={styles.box}>
      {describe ? <Readout ref={api} n={n} describe={describe} /> : null}
      <GestureHandlerRootView>
        <GestureDetector gesture={gesture}>
          <View style={{ height }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} {...a11y}>
            <View style={[styles.grid, { top: height - peak * scale }]} />
            <Text style={[styles.axisMax, { top: height - peak * scale + 2 }]}>{compactMinor(peak, currency)}</Text>
            {w ? <Highlight pos={pos} n={n} w={w} /> : null}
            {target ? <View style={[styles.target, { top: height - target.minor * scale, borderColor: target.color ?? C.label }]} /> : null}
            {target?.label ? <Text style={[styles.targetLabel, { top: height - target.minor * scale - 15, color: target.color ?? C.label }]} numberOfLines={1}>{target.label}</Text> : null}
            <Animated.View style={[styles.cols, { gap }, growStyle]} pointerEvents="none">
              {stacks.map((parts, i) => (
                <View key={i} style={styles.col}>
                  {parts.map((v, k) => <View key={k} style={[{ height: Math.max(0, v) * scale, backgroundColor: colors[k] ?? C.tint }, k === parts.length - 1 && styles.colTop]} />)}
                </View>
              ))}
            </Animated.View>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
      {startLabel || endLabel ? <View style={styles.axis}><Text style={styles.axisText}>{startLabel ?? ""}</Text><Text style={styles.axisText}>{endLabel ?? ""}</Text></View> : null}
      {legend}
    </View>
  );
}

/** A row of coloured keys under a chart: "● You put in  ● It grew". */
export function Legend({ items }: { items: { color: ColorValue; label: string; dashed?: boolean }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.swatch, it.dashed ? { backgroundColor: "transparent", borderTopWidth: 2, borderStyle: "dashed", borderColor: it.color, height: 0 } : { backgroundColor: it.color }]} />
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  box: { paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.sm, gap: 4 },
  pickLine: { fontSize: 12, color: C.label, fontVariant: ["tabular-nums"], minHeight: 16 },
  clip: { position: "absolute", left: 0, top: 0, overflow: "hidden" },
  grid: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: C.separator },
  axisMax: { position: "absolute", right: 0, fontSize: 10, color: C.secondary, fontVariant: ["tabular-nums"] },
  target: { position: "absolute", left: 0, right: 0, height: 0, borderTopWidth: 1, borderStyle: "dashed", opacity: 0.8 },
  targetLabel: { position: "absolute", left: 0, fontSize: 10, fontWeight: "600" },
  rule: { position: "absolute", left: 0, top: 0, width: 1, backgroundColor: C.secondary },
  dot: { position: "absolute", left: 0, top: 0, width: 8, height: 8, borderRadius: 4, borderWidth: 2, backgroundColor: C.card },
  band: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: C.fill, borderRadius: 3 },
  cols: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, flexDirection: "row", alignItems: "flex-end", transformOrigin: "bottom" },
  col: { flex: 1, flexDirection: "column-reverse", overflow: "hidden" },
  colTop: { borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 10, color: C.secondary },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: S.md, rowGap: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  swatch: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, color: C.secondary },
}));
