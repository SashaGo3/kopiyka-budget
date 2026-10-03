import { useEffect, useRef, useState } from "react";
import { Stack, router, useNavigationContainerRef, ThemeProvider, DarkTheme, DefaultTheme, type ErrorBoundaryProps } from "expo-router";
import { useColorScheme, AppState, InteractionManager, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import "@/db"; // opens + migrates synchronously before first render
import { Brand, C, R, S, currentTheme, themed } from "@/constants/theme";
import { registerThemeNavigation, takeThemeReturn, themeMounted, useTheme, type NavState, type ThemePickerRoute } from "@/lib/theme";
import { onAfterWrite } from "@/store";
import { installBackupTriggers } from "@/lib/backup";
import { writeWidgetSnapshot } from "@/lib/widget";
import { KPBridge } from "@/lib/bridge";
import { BootSkeleton } from "@/components/BootSkeleton";
import { notifyChange } from "@/store";
import { installNativeWrites } from "@/lib/nativeWrites";
import { openDeepLink, registerNavigationRef } from "@/lib/deeplink";
import { installCrashLog, recordCrash } from "@/lib/crashlog";
import { markAppCodeStart, markRootLayoutRender, onBooted } from "@/lib/boot";
import { maybeShowWhatsNew } from "@/lib/whatsNew";
import { needsOnboarding } from "@/lib/onboarding";
import { isPad, screenContentStyle } from "@/constants/layout";
import { t, useLanguage } from "@/i18n";

// Boot trace: the first line of our own code the JS bundle runs (see lib/boot.ts's `bootTrace`).
markAppCodeStart();

// Persist the last uncaught error to disk before anything else can go wrong. All builds, not just __DEV__.
installCrashLog();

// Answer watch / Shortcut writes from the first moment the bundle runs (they may arrive before the first render).
installNativeWrites();

/** A cold-start deep link (widget / watch / Shortcut) mounts `(tabs)` first and pushes the target sheet on top of it, instead of the sheet becoming the only screen. */
export const unstable_settings = { anchor: "(tabs)" };

/**
 * Sheets. On a phone a form sheet is sized by its detents — `fitToContents` measures the content and
 * the sheet is exactly that tall.
 *
 * On an iPad a form sheet is a fixed-size card and UIKit ignores those detents (react-native-screens
 * only applies sheet configuration to `formSheet`, and iPadOS sizes that presentation itself), so
 * anything taller than the card had its bottom quietly cut off — on the entry sheet that was the
 * save bar, which is the one thing the screen exists to reach. A page sheet there is a tall card the
 * content fits inside, and the content is pinned to its bottom edge so the room that is left over
 * appears above it, where the design already puts empty space.
 */
function sheetOptions() {
  const sheetContent: ViewStyle = { backgroundColor: C.bgGrouped, ...(isPad ? { justifyContent: "flex-end" as const } : null) };
  const sheet = { presentation: (isPad ? "modal" : "formSheet") as "modal" | "formSheet", headerShown: false, sheetGrabberVisible: true, sheetCornerRadius: 24, contentStyle: sheetContent };
  return {
    /** Entry sheets hug their content: no dead space above the amount (a phone sheet; see `sheet`). */
    fit: { ...sheet, sheetAllowedDetents: "fitToContents" as const },
    medium: { ...sheet, sheetAllowedDetents: [0.55, 0.92] },
    /** Pickers: a half-height sheet whose only child is the list (search lives in the list header). */
    picker: { ...sheet, sheetAllowedDetents: [0.6, 0.95], sheetInitialDetentIndex: 0 },
    /** Card modals draw their own plain header (ModalHeader), so no native glass buttons appear on iOS 26. */
    modal: { presentation: "modal" as const, headerShown: false, contentStyle: { backgroundColor: C.bgGrouped } },
  };
}
/**
 * A pushed full screen keeps the iPad column (constants/layout.ts). Sheets and modals do not: on a
 * tablet iOS already sizes those itself, and a column inside a centred card is a card with margins.
 * `(tabs)` is left out too — the tab bar belongs to the window, not to the content.
 */
const pushed = { contentStyle: screenContentStyle };

/**
 * Navigation colours that match the theme's backgrounds, so native headers never differ from the
 * content. Built at render: the theme is whichever is current when the tree (re-)mounts.
 */
function navigationTheme(dark: boolean) {
  return dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: Brand.bgDark, card: Brand.bgDark, primary: Brand.accentDark, border: Brand.borderDark, text: currentTheme().dark.text } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: Brand.bg, card: Brand.bg, primary: Brand.accent, border: Brand.border, text: currentTheme().light.text } };
}

export default function RootLayout() {
  markRootLayoutRender(); // boot trace: first render, not first effect — closer to when the tree starts committing
  const scheme = useColorScheme();
  // `+native-intent` navigates warm deep links itself, and needs the navigation state to do it.
  const navRef = useNavigationContainerRef();
  registerNavigationRef(navRef);
  // A theme switch captures where it was picked before the tree goes (src/lib/theme.ts).
  registerThemeNavigation(() => (navRef.isReady() ? (navRef.getRootState() as NavState | undefined) : undefined));
  // A new language mounts the whole tree again (see src/i18n): every screen, every memoised label.
  // The navigator starts over with it, so go back to where languages are changed — Settings, or the
  // restore that brought a different one in, which also lives there — or, before the welcome flow is
  // finished, to its first step, which has a language switch of its own.
  // What this layout wrote outside the tree is in the old language too: the widget snapshot and the
  // watch state carry names, and JS-scheduled reminders carry their text.
  const lang = useLanguage();
  // A new theme mounts the tree again the same way (src/lib/theme.ts). Picked on a picker, it comes
  // back to exactly the navigation state it left, in one step and with nothing animating, because the
  // whole switch happens under a snapshot of the old screen that fades once the new one has painted.
  // Without a picker — a restore that carried a theme — it goes where a language goes.
  const theme = useTheme();
  // The language and theme the tree on screen was mounted in. When they differ the tree is "parked":
  // one render with no navigator at all, so the old one's state is gone (it clears it on unmount)
  // before the saved state is put back, and the new navigator mounts straight into it.
  const [shown, setShown] = useState({ lang, theme });
  const parked = shown.lang !== lang || shown.theme !== theme;
  const afterMount = useRef<{ restored: boolean; back: ThemePickerRoute | null } | null>(null);
  useEffect(() => {
    if (!parked) return;
    const back = shown.theme !== theme ? takeThemeReturn() : null;
    let restored = false;
    if (back?.state && shown.lang === lang && navRef.isReady()) {
      try { navRef.resetRoot(back.state as Parameters<typeof navRef.resetRoot>[0]); restored = true; } catch { /* go by the route below */ }
    }
    afterMount.current = { restored, back: back?.route ?? null };
    // Deliberately a second commit: the parked one had to land first (see `shown`).
    setShown({ lang, theme }); // eslint-disable-line react-hooks/set-state-in-effect
  }, [parked, shown, lang, theme, navRef]);
  useEffect(() => {
    const after = afterMount.current;
    afterMount.current = null;
    if (!after) return;
    // The restored state put us back on the picker; if it did not take, navigate there the old way
    // (animated, but still under the cover).
    const back = after.back;
    const there = after.restored && (navRef.getCurrentRoute() as { name?: string } | undefined)?.name === "theme";
    const id = there ? undefined : setTimeout(() => {
      if (needsOnboarding()) { router.navigate(back === "/onboarding/theme" ? back : "/onboarding"); return; }
      router.navigate("/settings");
      if (back === "/settings/theme") router.push(back);
    }, 0);
    // Two frames: one for the new tree to be committed, one for it to be on the glass.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => themeMounted()); });
    return () => { if (id !== undefined) clearTimeout(id); cancelAnimationFrame(frame); };
  }, [shown, navRef]);
  const firstLang = useRef(lang);
  useEffect(() => {
    if (lang === firstLang.current) return;
    firstLang.current = lang;
    writeWidgetSnapshot();
    void (require("@/lib/notifications") as typeof import("@/lib/notifications")).rescheduleRecurringNotifications(); // eslint-disable-line @typescript-eslint/no-require-imports
  }, [lang]);
  useEffect(() => {
    // Startup-only work waits for the first frame (and any deep-linked sheet on top of it) to paint,
    // so a cold launch is never delayed by it. BootSkeleton's safety timeout guarantees this still
    // runs even when the landing screen never mounts (e.g. a deep link straight to a sheet).
    // expo-notifications (handler setup, native module discovery) is a heavy import nothing here
    // needs before the first frame, so it's required here instead of at module load.
    const notifications = require("@/lib/notifications") as typeof import("@/lib/notifications"); // eslint-disable-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications") as typeof import("expo-notifications"); // eslint-disable-line @typescript-eslint/no-require-imports
    const offBoot = onBooted(() => {
      InteractionManager.runAfterInteractions(() => {
        installBackupTriggers();
        writeWidgetSnapshot();
        maybeShowWhatsNew();
        void notifications.runAutoPosting().then(() => notifications.rescheduleRecurringNotifications());
        void notifications.syncBadge();
      });
    });
    // Coming back to the foreground: post anything that fell due, and re-read the database. A
    // Shortcut automation writes card payments straight into it while the app is suspended, and
    // nothing in JS ever hears about those — without this the entry only appears on a cold start.
    // A Shortcut automation sets the badge itself while the app is away; coming back re-reads it
    // from the database, so a queue approved on another device does not leave a number behind.
    const appState = AppState.addEventListener("change", (s) => { if (s === "active") { notifyChange(); void notifications.runAutoPosting(); void notifications.syncBadge(); } });
    // The badge is derived, never incremented: approving the queue here, on the watch or on another
    // phone all end at the same recount.
    const off = onAfterWrite(() => { writeWidgetSnapshot(); void notifications.rescheduleRecurringNotifications(); void notifications.syncBadge(); });
    // A tapped reminder goes where it is about: this debt, this recurring occurrence. The same
    // response can arrive twice — once cached from the cold launch that the tap caused, once live —
    // so each notification is followed only once.
    let followed: string | null = null;
    const follow = (r: import("expo-notifications").NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url;
      const id = r?.notification.request.identifier ?? null;
      if (typeof url !== "string" || (id !== null && id === followed)) return;
      followed = id;
      openDeepLink(url);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(follow);
    void Notifications.getLastNotificationResponseAsync().then(follow).catch(() => {});
    const offWatch = KPBridge.onExternalChange(() => notifyChange());
    return () => { offBoot(); off(); sub.remove(); offWatch(); appState.remove(); };
  }, []);
  const { fit, medium, picker, modal } = sheetOptions();
  return (
    <ThemeProvider value={navigationTheme(scheme === "dark")}>
      {parked ? <View style={{ flex: 1, backgroundColor: C.bg }} /> : <View key={`${shown.lang}:${shown.theme}`} style={{ flex: 1 }}>
        <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="log" options={{ headerShown: false, presentation: "transparentModal", animation: "none" }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          {/* A short read of variable length: a half sheet that can be dragged up, not a full card. */}
          <Stack.Screen name="whats-new" options={medium} />
          <Stack.Screen name="accounts/[id]" options={{ ...pushed, title: "", headerBackTitle: t("common.back") }} />
          <Stack.Screen name="pending" options={{ ...pushed, title: t("layout.pending"), headerBackTitle: t("common.back") }} />
          <Stack.Screen name="transaction/[id]" options={fit} />
          <Stack.Screen name="transaction/split" options={modal} />
          {/* A list that has to be read before it is agreed to, so a full card rather than a sheet. */}
          <Stack.Screen name="transaction/bulk" options={modal} />
          <Stack.Screen name="transfer/[id]" options={fit} />
          <Stack.Screen name="account/edit" options={fit} />
          <Stack.Screen name="category/edit" options={modal} />
          {/* Two questions and a list to read before agreeing to it, so a full card rather than a sheet. */}
          <Stack.Screen name="category/importance" options={modal} />
          <Stack.Screen name="tag/edit" options={modal} />
          <Stack.Screen name="budget/edit" options={fit} />
          {/* The one screen with a drag: the sheet's own swipe-to-dismiss would be pulling against
              every downward drag of a row, and it has Cancel and Done of its own. */}
          <Stack.Screen name="budget/reorder" options={{ ...modal, gestureEnabled: false }} />
          <Stack.Screen name="budget/planned" options={modal} />
          <Stack.Screen name="debt/edit" options={fit} />
          <Stack.Screen name="travel/start" options={fit} />
          <Stack.Screen name="travel/dates" options={fit} />
          <Stack.Screen name="travel/backfill" options={modal} />
          <Stack.Screen name="travel/outside" options={modal} />
          <Stack.Screen name="receipt/scan" options={{ presentation: "fullScreenModal", headerShown: false }} />
          <Stack.Screen name="photo/capture" options={{ presentation: "fullScreenModal", headerShown: false }} />
          <Stack.Screen name="photo/view" options={{ presentation: "fullScreenModal", headerShown: false }} />
          <Stack.Screen name="recurring/[id]" options={modal} />
          <Stack.Screen name="recurring/confirm" options={fit} />
          <Stack.Screen name="recurring/due" options={{ ...pushed, title: t("layout.recurringDue"), headerBackTitle: t("common.back") }} />
          <Stack.Screen name="pick/category" options={picker} />
          <Stack.Screen name="pick/icon" options={picker} />
          <Stack.Screen name="pick/color" options={picker} />
          <Stack.Screen name="pick/account" options={picker} />
          <Stack.Screen name="pick/currency" options={picker} />
          <Stack.Screen name="pick/tags" options={picker} />
          <Stack.Screen name="pick/group" options={picker} />
          <Stack.Screen name="pick/text" options={modal} />
          <Stack.Screen name="pick/date" options={fit} />
          <Stack.Screen name="pick/time" options={fit} />
          <Stack.Screen name="pick/option" options={fit} />
          <Stack.Screen name="pick/month" options={fit} />
          <Stack.Screen name="pick/amount" options={fit} />
          <Stack.Screen name="pick/accounts" options={picker} />
          <Stack.Screen name="pick/categories" options={picker} />
          <Stack.Screen name="pick/transaction" options={picker} />
          <Stack.Screen name="pick/location" options={modal} />
          <Stack.Screen name="insight/edit" options={modal} />
          {/* A drag list, like budget/reorder: the sheet's own swipe would fight every row. */}
          <Stack.Screen name="insight/reorder" options={{ ...modal, gestureEnabled: false }} />
          <Stack.Screen name="filter" options={modal} />
        </Stack>
        <BootSkeleton />
      </View>}
    </ThemeProvider>
  );
}

/** Deep link helpers, used by widgets/watch/notifications. */
export const links = {
  newTransaction: (p: { account?: string; category?: string; amount?: string; kind?: "expense" | "income" } = {}) =>
    router.push({ pathname: "/transaction/[id]", params: { id: "new", ...p } }),
};

/** expo-router renders this per route on an uncaught render error. Logs through the same writer as `installCrashLog`, then offers a retry instead of the native red/white crash screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { recordCrash(error, false); }, [error]);
  return (
    <View style={errorStyles.screen}>
      <Text style={errorStyles.title}>{t("layout.error.title")}</Text>
      <Text style={errorStyles.message}>{error.message}</Text>
      <Pressable onPress={() => void retry()} accessibilityRole="button" accessibilityLabel={t("common.retry")} style={({ pressed }) => [errorStyles.button, pressed && { opacity: 0.7 }]}>
        <Text style={errorStyles.buttonText}>{t("common.retry")}</Text>
      </Pressable>
    </View>
  );
}

const errorStyles = themed(() => StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: S.md, padding: S.xl, backgroundColor: C.bgGrouped },
  title: { fontSize: 20, fontWeight: "700", color: C.label },
  message: { fontSize: 14, color: C.secondary, textAlign: "center" },
  button: { marginTop: S.md, paddingHorizontal: S.xl, paddingVertical: S.md, borderRadius: R.lg, backgroundColor: C.tint },
  buttonText: { fontSize: 16, fontWeight: "600", color: C.onTint },
}));
