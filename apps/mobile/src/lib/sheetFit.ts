import { useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { KEY_HEIGHT } from "@/components/Keypad";
import { useWindowInsets } from "@/constants/layout";

/** The lowest a keypad row goes to keep a sheet on screen. */
const KEY_MIN = 32;
/** Four rows of keys and the operator row at 0.72. */
const KEY_ROWS = 4.72;
/** The gap iOS leaves above a sheet, and a cushion for the display's rounded foot. */
const SHEET_GAP = 12;
const SHEET_CUSHION = 16;

/**
 * A sheet sized to its content (`fitToContents`) must never be taller than the screen: the Save bar
 * at its foot is what the sheet exists to reach, and on a short screen (the folded iPhone Duo's outer
 * one is 678 pt) a keypad sheet ran past it. So the sheet measures itself (`onLayout` on
 * `SheetFrame`) and, when it is taller than the room a sheet gets, gives up the difference.
 *
 * `extra` is what the screen itself can spare first, in points (chips laid flat, a hint left out);
 * the screen reads `squeeze` and spends it in its own order. What is left shrinks the keypad's rows,
 * down to `KEY_MIN`. `tight` is true once anything has been given up. With room again (unfolded)
 * it all comes back.
 *
 * The room is the window less the window's top inset: inside a sheet its own inset reads 0.
 */
export function useSheetFit(extra = 0, paused = false): { onLayout: (e: LayoutChangeEvent) => void; squeeze: number; keyHeight: number; tight: boolean } {
  const { height: windowHeight } = useWindowDimensions();
  const windowTop = useWindowInsets().top;
  const [squeeze, setSqueeze] = useState(0);
  const max = extra + Math.ceil((KEY_HEIGHT - KEY_MIN) * KEY_ROWS);
  const onLayout = (e: LayoutChangeEvent) => {
    if (paused) return;
    const over = e.nativeEvent.layout.height - (windowHeight - windowTop - SHEET_GAP - SHEET_CUSHION);
    const next = Math.min(max, Math.max(0, squeeze + over));
    // Shrinking at once; growing back only for a real gain, or the two would take turns.
    if (over > 0 ? next > squeeze : next < squeeze - 8) setSqueeze(next);
  };
  const keyHeight = Math.max(KEY_MIN, KEY_HEIGHT - Math.ceil(Math.max(0, squeeze - extra) / KEY_ROWS));
  return { onLayout, squeeze, keyHeight, tight: squeeze > 0 };
}
