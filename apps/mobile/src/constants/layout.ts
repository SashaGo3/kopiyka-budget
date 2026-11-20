import { useMemo } from "react";
import { Platform, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * iPad. The app is one column of cards and lists designed for a thumb, and a thumb does not get
 * wider with the screen: stretched across 1366 points a transaction row puts its amount a hand's
 * width from its name. So on a tablet the content keeps a phone-ish measure and sits in the middle
 * of the window, the way Settings and Mail do, and the native chrome around it (headers, the tab
 * bar, sheets) is left to iPadOS, which already knows what to do with the room.
 *
 * `width: "100%"` with a cap rather than a fixed width, because an iPad in Split View or Slide Over
 * is often narrower than a phone, and the column has to give the room back.
 */
export const isPad = Platform.OS === "ios" && Platform.isPad;

/** As wide as the column is ever allowed to get. Roughly two phones side by side. */
export const CONTENT_MAX_WIDTH = 780;

/**
 * Stack `contentStyle` for every screen, on every device: what decides it is the window, not the
 * device. A phone's window is always narrower than the cap, so it is inert there; an unfolded
 * iPhone Duo is an iPhone with a tablet's width, and gets the centred column like an iPad does.
 */
export const screenContentStyle: ViewStyle = { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" };

/**
 * `screenContentStyle` inside the window's side safe area. Every iPhone and iPad in portrait has none,
 * but the folded iPhone Duo keeps the status bar, the header's buttons and the tab bar in a column
 * down one side, and content laid out to the window's edge ran underneath it.
 */
export function useScreenContentStyle(): ViewStyle {
  const { left, right } = useSafeAreaInsets();
  return useMemo(() => (left || right ? { ...screenContentStyle, paddingLeft: left, paddingRight: right } : screenContentStyle), [left, right]);
}

/** Caps anything sized off the window rather than its container (the Log button, mostly). */
export function contentWidth(windowWidth: number): number {
  return Math.min(windowWidth, CONTENT_MAX_WIDTH);
}

/**
 * How far the window's edge is from the centred column's, so a floating control can step out of the
 * column and sit against the screen instead of on top of what it controls. 0 on a phone, and 0 on an
 * iPad in Split View — there the window is narrower than the cap and the column is the whole of it.
 */
export function columnOverhang(windowWidth: number): number {
  return Math.max(0, (windowWidth - CONTENT_MAX_WIDTH) / 2);
}

/** Width of a floating action button in the iPad column: one measure, so the stack has a straight edge. */
export const PAD_BUTTON_WIDTH = 200;
