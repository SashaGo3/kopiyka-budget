import { useEffect } from "react";
import { Stack, router, useNavigationContainerRef, ThemeProvider, DarkTheme, DefaultTheme, type ErrorBoundaryProps } from "expo-router";
import { useColorScheme, AppState, InteractionManager, Pressable, StyleSheet, Text, View } from "react-native";
import "@/db"; // opens + migrates synchronously before first render
import { initLanguage, useT } from "@/i18n";
import { Brand, C, R, S } from "@/constants/theme";
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

// Boot trace: the first line of our own code the JS bundle runs (see lib/boot.ts's `bootTrace`).
markAppCodeStart();

// The language, before anything renders a word: the stored choice, or the phone's own (src/i18n).
initLanguage();

// Persist the last uncaught error to disk before anything else can go wrong. All builds, not just __DEV__.
installCrashLog();

// Answer watch / Shortcut writes from the first moment the bundle runs (they may arrive before the first render).
installNativeWrites();

/** A cold-start deep link (widget / watch / Shortcut) mounts `(tabs)` first and pushes the target sheet on top of it, instead of the sheet becoming the only screen. */
export const unstable_settings = { anchor: "(tabs)" };

const sheet = { presentation: "formSheet" as const, headerShown: false, sheetGrabberVisible: true, sheetCornerRadius: 24, contentStyle: { backgroundColor: C.bgGrouped } };
/** Entry sheets hug their content: no dead space above the amount. */
const fit = { ...sheet, sheetAllowedDetents: "fitToContents" as const };
const medium = { ...sheet, sheetAllowedDetents: [0.55, 0.92] };
/** Pickers: a half-height sheet whose only child is the list (search lives in the list header). */
const picker = { ...sheet, sheetAllowedDetents: [0.6, 0.95], sheetInitialDetentIndex: 0 };
/** Card modals draw their own plain header (ModalHeader), so no native glass buttons appear on iOS 26. */
const modal = { presentation: "modal" as const, headerShown: false, contentStyle: { backgroundColor: C.bgGrouped } };

/** Navigation colours that match iOS grouped backgrounds, so native headers never differ from the content. */
const lightTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: Brand.bg, card: Brand.bg, primary: Brand.accent, border: Brand.border } };
const darkTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: Brand.bgDark, card: Brand.bgDark, primary: Brand.accentDark, border: Brand.borderDark } };

export default function RootLayout() {
  markRootLayoutRender(); // boot trace: first render, not first effect — closer to when the tree starts committing
  const scheme = useColorScheme();
  // Subscribes the root to the language, so the native header titles below follow a change made in Settings.
  const t = useT();
  // `+native-intent` navigates warm deep links itself, and needs the navigation state to do it.
  registerNavigationRef(useNavigationContainerRef());
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
        void notifications.runAutoPosting().then(() => notifications.rescheduleRecurringNotifications());
      });
    });
    // Coming back to the foreground: post anything that fell due, and re-read the database. A
    // Shortcut automation writes card payments straight into it while the app is suspended, and
    // nothing in JS ever hears about those — without this the entry only appears on a cold start.
    const appState = AppState.addEventListener("change", (s) => { if (s === "active") { notifyChange(); void notifications.runAutoPosting(); } });
    const off = onAfterWrite(() => { writeWidgetSnapshot(); void notifications.rescheduleRecurringNotifications(); });
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
  return (
    <ThemeProvider value={scheme === "dark" ? darkTheme : lightTheme}>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="log" options={{ headerShown: false, presentation: "transparentModal", animation: "none" }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="accounts/[id]" options={{ title: "", headerBackTitle: t("Back") }} />
          <Stack.Screen name="pending" options={{ title: t("Pending"), headerBackTitle: t("Back") }} />
          <Stack.Screen name="transaction/[id]" options={fit} />
          <Stack.Screen name="transfer/[id]" options={fit} />
          <Stack.Screen name="account/edit" options={fit} />
          <Stack.Screen name="category/edit" options={modal} />
          <Stack.Screen name="tag/edit" options={modal} />
          <Stack.Screen name="budget/edit" options={fit} />
          <Stack.Screen name="debt/edit" options={fit} />
          <Stack.Screen name="travel/start" options={fit} />
          <Stack.Screen name="travel/backfill" options={modal} />
          <Stack.Screen name="receipt/scan" options={{ presentation: "fullScreenModal", headerShown: false }} />
          <Stack.Screen name="photo/capture" options={{ presentation: "fullScreenModal", headerShown: false }} />
          <Stack.Screen name="photo/view" options={{ presentation: "fullScreenModal", headerShown: false }} />
          <Stack.Screen name="recurring/[id]" options={modal} />
          <Stack.Screen name="recurring/confirm" options={fit} />
          <Stack.Screen name="recurring/due" options={{ title: t("Recurring due"), headerBackTitle: t("Back") }} />
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
          <Stack.Screen name="filter" options={modal} />
        </Stack>
        <BootSkeleton />
      </View>
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
  const t = useT();
  useEffect(() => { recordCrash(error, false); }, [error]);
  return (
    <View style={errorStyles.screen}>
      <Text style={errorStyles.title}>{t("Something went wrong")}</Text>
      <Text style={errorStyles.message}>{error.message}</Text>
      <Pressable onPress={() => void retry()} accessibilityRole="button" accessibilityLabel={t("Try again")} style={({ pressed }) => [errorStyles.button, pressed && { opacity: 0.7 }]}>
        <Text style={errorStyles.buttonText}>{t("Try again")}</Text>
      </Pressable>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: S.md, padding: S.xl, backgroundColor: C.bgGrouped },
  title: { fontSize: 20, fontWeight: "700", color: C.label },
  message: { fontSize: 14, color: C.secondary, textAlign: "center" },
  button: { marginTop: S.md, paddingHorizontal: S.xl, paddingVertical: S.md, borderRadius: R.lg, backgroundColor: C.tint },
  buttonText: { fontSize: 16, fontWeight: "600", color: C.onTint },
});
