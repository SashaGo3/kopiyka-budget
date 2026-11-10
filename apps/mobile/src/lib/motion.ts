import { AccessibilityInfo, LayoutAnimation } from "react-native";

/**
 * Reduce Motion, for the animations Reanimated does not already handle (its entering, exiting and
 * `useReducedMotion` do). Read once at launch and kept current by the system's own event, so a
 * component can ask synchronously while it renders.
 */
let reduced = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduced = v; }).catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => { reduced = v; });

export function reduceMotion(): boolean { return reduced; }

/** The next layout change animates, unless Reduce Motion is on — then it simply lands. */
export function animateNextLayout(): void {
  if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/**
 * How long one item of a staggered list waits: a step per item, capped, so the twentieth card is
 * not still arriving after the first has been read — and nothing waits at all with Reduce Motion.
 */
export function staggerDelay(index: number, step = 50, max = 250): number {
  return reduced ? 0 : Math.min(index * step, max);
}
