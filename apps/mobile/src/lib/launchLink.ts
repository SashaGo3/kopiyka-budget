/**
 * Screenshot builds only: open the link the capture launched the app with (`-KPLink`), the way a
 * link that arrives while the app is running is opened. On the iPad a link handed over by
 * `simctl openurl` waits behind iPadOS's "Open in …" prompt, and nothing on Xcode 27 can tap it away
 * (scripts/screenshots/capture.sh); a launch argument needs no prompt.
 */
import { router } from "expo-router";
import { redirectSystemPath } from "@/app/+native-intent";
import { SCREENSHOT_BUILD } from "@/constants/features";
import { KPBridge } from "./bridge";

export function openLaunchLink(): void {
  if (!SCREENSHOT_BUILD) return;
  const link = KPBridge.launchLink();
  if (!link) return;
  // Also marks the launch as having somewhere to be, so nothing else opens on top of it.
  const path = redirectSystemPath({ path: link, initial: false });
  if (path) router.navigate(path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "/") as never);
}
