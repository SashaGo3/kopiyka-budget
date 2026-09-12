import { openEntrySheet } from "@/lib/deeplink";
import { needsOnboarding } from "@/lib/onboarding";

/**
 * Every URL the app is handed passes through here before expo-router routes it — the launch URL,
 * widget taps, the watch, notifications, Siri / the Action button / Shortcuts (`OpenLogIntent`)
 * and the home-screen quick action. Anything not named below is returned untouched.
 *
 * * The **root URL** (`kopiyka:///`, what a plain launch gets) is resolved to the screen `app/index`
 *   would have redirected to. Routed as `/`, that redirect *replaces* the index screen with
 *   `(tabs)` while the root Stack's anchor has already put a `(tabs)` underneath it — leaving two
 *   tab screens stacked for the rest of the session, and `dismissAll()` landing on the stale one
 *   (which is what made a deep link look like it pushed a screen before opening its sheet).
 * * A **cold** quick-log link (`kopiyka://log`, and the widget's `kopiyka://transaction/new`)
 *   becomes the sheet's own route, so the app mounts `(tabs)` with the Log sheet already on top of
 *   it rather than routing through the `/log` redirect screen.
 * * A **warm** quick-log link is navigated by `openEntrySheet` and swallowed here (`null` stops the
 *   router), because the router's own handling pushes a second sheet on top of the open one.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  // `path` is the whole URL on native (`kopiyka://log?amount=3`). Anything we don't recognise —
  // including the dev client's own wrapper URLs — is handed back exactly as it came in.
  const [route = "", query = ""] = path.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").split("?");
  const name = route.replace(/^\/+|\/+$/g, "");
  if (!name) {
    try { return needsOnboarding() ? "/onboarding" : "/transactions"; } catch { return path; } // the database is opened by the root layout; before that, route as before
  }
  if (name !== "log" && name !== "transaction/new") return path;

  const params = { ...(name === "log" ? { kind: "expense" } : null), ...parseQuery(query) };
  if (initial) return `/transaction/new?${Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
  openEntrySheet(params);
  return null;
}

function parseQuery(query: string) {
  const out: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const decode = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    out[decode(eq < 0 ? pair : pair.slice(0, eq))] = eq < 0 ? "" : decode(pair.slice(eq + 1));
  }
  return out;
}
