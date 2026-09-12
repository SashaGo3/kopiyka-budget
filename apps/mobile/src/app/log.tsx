import { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import { openEntrySheet } from "@/lib/deeplink";

/**
 * Fallback for `kopiyka://log` (the "New expense" App Intent / Action button, Siri, the
 * `dev.kopiyka.log` home-screen quick action). Those links are normally turned into the Log sheet
 * by `+native-intent` before the router ever sees them, so this screen is only reached by a
 * `/log` navigation from inside the app. It hands over to the same place they do — the Log sheet,
 * which mounts above `(tabs)` thanks to the root Stack's anchor — and `openEntrySheet` dismisses
 * this screen on the way, so it never stays in the stack.
 */
export default function LogRedirect() {
  const params = useLocalSearchParams<Record<string, string>>();
  useEffect(() => {
    openEntrySheet({ kind: "expense", ...params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
