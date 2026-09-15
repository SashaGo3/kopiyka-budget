import { AppState } from "react-native";
import { router, type useNavigationContainerRef } from "expo-router";

/**
 * Where deep links that arrive while the app is already running are turned into navigation.
 *
 * `src/app/+native-intent.ts` calls in here instead of letting expo-router route the URL itself.
 * The router's own handling of a warm link builds the target state from the path and navigates to
 * it, which means a second entry sheet lands on top of the open one; and it runs the moment the URL
 * arrives, so with the app coming back from the background the navigation animates behind the
 * foreground transition. Here the link is instead deduplicated against what is already on screen
 * and applied once the app is actually on it.
 */

type NavRef = ReturnType<typeof useNavigationContainerRef>;
type Params = Record<string, string>;

let navRef: NavRef | null = null;

/** Called once from the root layout: `+native-intent` runs outside React and has no other way to read the navigation state. */
export function registerNavigationRef(ref: NavRef) {
  navRef = ref;
}

/** The root Stack's screens — `(tabs)` plus every sheet above it. Empty until the tree is mounted. */
function rootStackRoutes(): { name: string; params?: object }[] {
  if (!navRef?.isReady()) return [];
  const state = navRef.getRootState();
  // The container's only screen is expo-router's internal `__root` slot, which renders our root Stack.
  const stack = state.routes[0]?.name === "__root" ? state.routes[0].state : state;
  return (stack?.routes as { name: string; params?: object }[] | undefined) ?? [];
}

/** What the entry sheet reads off the route (see `transaction/[id]`). Compared by name so the router's own params never count as a difference. */
const ENTRY_KEYS = ["id", "kind", "account", "category", "amount", "note", "tags", "receipt"];

function sameParams(a: Params, b: object | undefined) {
  const other = (b ?? {}) as Params;
  return ENTRY_KEYS.every((k) => String(a[k] ?? "") === String(other[k] ?? ""));
}

/** Runs `fn` with the app on screen: a link delivered during the foreground transition would otherwise animate behind it. */
function whenActive(fn: () => void) {
  if (AppState.currentState === "active") return fn();
  const sub = AppState.addEventListener("change", (s) => {
    if (s !== "active") return;
    sub.remove();
    fn();
  });
}

/**
 * Opens the new-entry sheet for `kopiyka://log` / `kopiyka://transaction/new` (Action button, Siri,
 * the Shortcuts action, the home-screen quick action, the widget's "+").
 *
 * Triggering the same link twice must not close and re-open the keypad, so a link that points at
 * the sheet already on top — same params and all — does nothing. Anything else open above the tabs
 * (an older entry, a picker) is dismissed first, so exactly one entry sheet is ever on screen.
 */
export function openEntrySheet(params: Params) {
  const target = { id: "new", ...params };
  whenActive(() => {
    const routes = rootStackRoutes();
    const top = routes[routes.length - 1];
    if (top?.name === "transaction/[id]" && sameParams(target, top.params)) return;
    if (routes.length > 1) router.dismiss(routes.length - 1); // an older entry, a picker: everything above the tabs goes
    router.push({ pathname: "/transaction/[id]", params: target });
  });
}

/** `kopiyka://settings/debts?x=1` → the path and params expo-router wants. */
export function parseLink(url: string): { name: string; params: Params } {
  const [route = "", query = ""] = url.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").split("?");
  return { name: route.replace(/^\/+|\/+$/g, ""), params: parseQuery(query) };
}

export function parseQuery(query: string): Params {
  const out: Params = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const decode = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, " ")); } catch { return x; } };
    out[decode(eq < 0 ? pair : pair.slice(0, eq))] = eq < 0 ? "" : decode(pair.slice(eq + 1));
  }
  return out;
}

/**
 * Follow a `kopiyka://` link from inside the app — what tapping a notification does (the reminder
 * says which debt or which recurring rule it is about, so it has to land there).
 *
 * Navigated here rather than handed back to iOS through `Linking.openURL`: the round trip out of the
 * app and in again is the app opening itself, which is the one thing the system need not honour, and
 * it would arrive at `+native-intent` with no way to tell it from a cold launch. Everything above the
 * tabs is dismissed first, so a tap never buries the target under a sheet that was already open.
 */
export function openDeepLink(url: string) {
  const { name, params } = parseLink(url);
  if (!name) return;
  if (name === "log" || name === "transaction/new") { openEntrySheet(params); return; }
  whenActive(() => {
    const routes = rootStackRoutes();
    if (routes.length > 1) router.dismiss(routes.length - 1);
    // A plain href when there is nothing to carry, so a link naming a row ("transaction/<id>") is
    // matched against the route tree rather than taken for a route pattern of its own.
    const href = Object.keys(params).length ? { pathname: `/${name}`, params } : `/${name}`;
    router.push(href as Parameters<typeof router.push>[0]);
  });
}

