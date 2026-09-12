import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from "react-native";
import { GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

/**
 * The one place that knows how glass is drawn.
 *
 * Glass is for the *floating* layer only — the bottom bar, the header pills: chrome that
 * hovers over scrolling content. Content itself (cards, rows, the keypad) stays opaque;
 * glass stacked on an opaque background just reads as muddy grey.
 *
 * Backed by `expo-glass-effect`, which ships with the SDK and is already built into ios/.
 * `@callstack/liquid-glass` is the same UIGlassEffect under a different name — to switch,
 * `bun add @callstack/liquid-glass`, prebuild, and change the three lines below:
 *   GlassView      -> LiquidGlassView      (glassEffectStyle -> effect, isInteractive -> interactive)
 *   GlassContainer -> LiquidGlassContainerView
 *   supported()    -> isLiquidGlassSupported
 * Nothing outside this file needs to change; it has no `isGlassEffectAPIAvailable` guard, though.
 */

let cached: boolean | undefined;
/** Resolved on first render, not on import: touching the native module is off the boot path. */
function supported(): boolean {
  // isGlassEffectAPIAvailable guards the iOS 26 betas where the API is missing and GlassView crashes.
  if (cached === undefined) cached = isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  return cached;
}

/**
 * Whether to draw glass right now. False below iOS 26, and false when the reader has
 * Reduce Transparency on — that setting exists precisely to turn materials like this off.
 */
export function useGlass(): boolean {
  const [on, setOn] = useState(() => supported());
  useEffect(() => {
    if (!supported()) return;
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((reduce) => { if (alive) setOn(!reduce); });
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (reduce) => setOn(!reduce));
    return () => { alive = false; sub.remove(); };
  }, []);
  return on;
}

/**
 * A glass surface, or `solid` when glass is unavailable. Keep every opaque fill (background
 * colour, border) in `solid`: a backgroundColor on real glass paints over the material.
 */
export function Glass({ style, solid, tint, interactive, clear, children }: {
  style?: StyleProp<ViewStyle>;
  /** Fallback look below iOS 26 / under Reduce Transparency — the pre-glass card styling. */
  solid?: StyleProp<ViewStyle>;
  tint?: string;
  interactive?: boolean;
  clear?: boolean;
  children?: ReactNode;
}) {
  if (!useGlass()) return <View style={[style, solid]}>{children}</View>;
  return <GlassView style={style} glassEffectStyle={clear ? "clear" : "regular"} tintColor={tint} isInteractive={interactive}>{children}</GlassView>;
}

/**
 * Groups sibling `Glass` surfaces so they bleed into one another as they come within
 * `spacing` of each other — the bottom bar's buttons behave as one piece of glass.
 */
export function GlassGroup({ spacing = 12, style, children }: { spacing?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  if (!useGlass()) return <View style={style}>{children}</View>;
  return <GlassContainer spacing={spacing} style={style}>{children}</GlassContainer>;
}
