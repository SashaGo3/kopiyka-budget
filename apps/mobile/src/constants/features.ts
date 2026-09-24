/** Feature switches. Flip and reload; no code paths are removed. */
import { Platform } from "react-native";

/** In-app receipt photographing (long-press Log, Receipt chip). Off for now: slow and inaccurate on device. The Shortcut intent is unaffected. */
export const RECEIPT_SCANNER_ENABLED = false;

/**
 * The Shortcuts automation that logs bank notifications rests on the "When I receive a
 * notification" trigger, which arrived in iOS 27. Below that the trigger is not in the Shortcuts
 * list at all, so the setup cannot be followed — the app says so instead of letting someone hunt
 * for a row that is not there. Nothing else is gated: the app's own minimum is iOS 18, and the
 * widget, the watch, Siri and the Log expense action all work there.
 */
export const AUTOMATION_MIN_IOS = 27;
const iosVersion = Platform.OS === "ios" ? parseFloat(String(Platform.Version)) : 0;
/** True on anything that could run the automation; an unreadable version is given the benefit of the doubt. */
export const AUTOMATION_SUPPORTED = Platform.OS !== "ios" || !Number.isFinite(iosVersion) || iosVersion >= AUTOMATION_MIN_IOS;
/** What this device runs, for the note that says why the automation is unavailable ("" when unknown). */
export const IOS_VERSION = Platform.OS === "ios" && Number.isFinite(iosVersion) ? String(Platform.Version) : "";
