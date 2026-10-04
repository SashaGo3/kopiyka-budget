import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { HOME_RADIUS_M, debtTotals, formatMinor, listDebts, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { getPeriodStartDay, setPeriodStartDay } from "@/lib/period";
import { notifyChange } from "@/store";
import { C, S, themed } from "@/constants/theme";
import { APP_MARKETING_VERSION, APP_VERSION, privacyPolicyUrl } from "@/constants/app";
import { releasesToRead } from "@/lib/whatsNew";
import { AUTOMATION_MIN_IOS, AUTOMATION_SUPPORTED } from "@/constants/features";
import { lastBackupLine, useBackupState } from "@/lib/backup";
import { getHideIncome, getHomeLocation, getLocationEnabled, getShowBalance, setHideIncome, setHomeLocation, setLocationEnabled, setShowBalance } from "@/lib/settings";
import { ensureLocationPermission, locationStatus, placeName, preciseLocation } from "@/lib/location";
import { tripLine, useActiveTrip, useTripStats } from "@/lib/travel";
import { dayMonth, humanDayTime } from "@/lib/dates";
import { appearanceName, themeName } from "@/components/ThemePicker";
import { getTheme, useAppearance } from "@/lib/theme";
import { LANGUAGES, deviceLanguage, getLanguage, isFollowingDevice, setLanguage, t, type LanguageCode } from "@/i18n";

/** "22nd" / "22-го": a day of the month, as in "starts on the …". */
const ordinal = (day: number) => t("settings.startDay.ordinal", { day });

export default function SettingsScreen() {
  const appearance = useAppearance();
  const backup = useBackupState();
  const prefs = useQuery(() => ({ startDay: getPeriodStartDay(), location: getLocationEnabled(), home: getHomeLocation(), hideIncome: getHideIncome(), showBalance: getShowBalance() }));
  const counts = useQuery((db) => {
    const openDebts = listDebts(db, { settled: false });
    const debtCurrencies = new Set(openDebts.map((d) => d.currency));
    // Only worth a net figure when every open debt is in the same currency; otherwise just the count (see debtTotals).
    const debtNet = debtCurrencies.size === 1 ? debtTotals(openDebts)[0] : null;
    return {
      accounts: listRows(db, "accounts").length,
      categories: listRows(db, "categories").length,
      tags: listRows(db, "tags").length,
      recurring: listRows(db, "recurring_rules", "deleted=0 AND active=1").length,
      tx: db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0`)?.n ?? 0,
      debts: openDebts.length,
      debtNet,
    };
  });
  const debtSubtitle = (() => {
    if (!counts.debts) return t("settings.debts.none");
    const open = t("settings.debts.open", { count: counts.debts });
    if (!counts.debtNet) return open;
    const diff = counts.debtNet.owed_to_me_minor - counts.debtNet.i_owe_minor;
    if (!diff) return open;
    const amount = `${formatMinor(Math.abs(diff), counts.debtNet.currency)} ${counts.debtNet.currency}`;
    return diff > 0 ? t("settings.debts.owedToYou", { open, amount }) : t("settings.debts.youOwe", { open, amount });
  })();
  const keys = useMemo(() => ({ day: newPickKey("startday"), custom: newPickKey("startcustom") }), []);
  const setDay = useCallback((v: string) => { setPeriodStartDay(Number(v)); notifyChange(); }, []);
  usePickResult<string>(keys.custom, setDay);
  usePickResult<string>(keys.day, useCallback((v: string) => {
    if (v !== "custom") { setDay(v); return; }
    // The first sheet is still dismissing when this runs; push the next one once it is gone.
    setTimeout(() => router.push({ pathname: "/pick/option", params: { key: keys.custom, title: t("settings.startDay.pickDay"), selected: String(getPeriodStartDay()),
      options: JSON.stringify(Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }))) } }), 450);
  }, [keys.custom, setDay]));
  const pickDay = () => router.push({ pathname: "/pick/option", params: { key: keys.day, title: t("settings.startDay.title"), selected: prefs.startDay === 1 || prefs.startDay === 15 ? String(prefs.startDay) : "custom",
    options: JSON.stringify([{ value: "1", label: ordinal(1), subtitle: t("settings.startDay.calendarMonth") }, { value: "15", label: ordinal(15), subtitle: t("settings.startDay.midMonth") }, { value: "custom", label: t("settings.startDay.customLabel"), subtitle: prefs.startDay !== 1 && prefs.startDay !== 15 ? t("settings.startDay.currently", { ordinal: ordinal(prefs.startDay) }) : t("settings.startDay.anyDay") }]) } });
  // Language: the phone's, or one picked here. The choice re-mounts the app in the new language
  // (src/i18n), so it is applied once this sheet has finished closing, not while it is on screen.
  const langKey = useMemo(() => newPickKey("language"), []);
  usePickResult<string>(langKey, useCallback((v: string) => {
    setTimeout(() => setLanguage(v === "system" ? null : (v as LanguageCode)), 450);
  }, []));
  const ownName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const pickLanguage = () => router.push({ pathname: "/pick/option", params: {
    key: langKey, title: t("common.language.title"), selected: isFollowingDevice() ? "system" : getLanguage(),
    options: JSON.stringify([
      { value: "system", label: t("common.language.system"), subtitle: ownName(deviceLanguage()) },
      ...LANGUAGES.map((l) => ({ value: l.code, label: l.name, subtitle: l.code === getLanguage() ? undefined : l.english })),
    ]) } });
  const languageLine = isFollowingDevice() ? t("common.language.systemNow", { name: ownName(getLanguage()) }) : ownName(getLanguage());
  const trip = useActiveTrip();
  const tripStats = useTripStats(trip);
  // Permission: iOS state is read on every focus (the user may come back from the Settings app).
  // Notifications are switched on in Settings → Recurring, beside the reminders they are for.
  const [perm, setPerm] = useState<{ loc: "granted" | "denied" | "undetermined" }>({ loc: "undetermined" });
  const refreshPerm = useCallback(() => { void locationStatus().then((loc) => setPerm({ loc })); }, []);
  useEffect(refreshPerm, [refreshPerm]);
  useFocusEffect(refreshPerm);
  const toggleLocation = async (on: boolean) => {
    if (on && perm.loc === "denied") { void Linking.openSettings(); return; }
    if (on && !(await ensureLocationPermission())) { refreshPerm(); return; }
    setLocationEnabled(on);
    refreshPerm();
  };
  // Home: where no category should be suggested (everything gets bought at home).
  const [settingHome, setSettingHome] = useState(false);
  const useHereAsHome = async () => {
    setSettingHome(true);
    try {
      const c = await preciseLocation();
      if (!c) { Alert.alert(t("settings.home.noFixTitle"), t("settings.home.noFixMessage")); return; }
      setHomeLocation({ ...c, place: await placeName(c) });
    } finally { setSettingHome(false); }
  };
  const pickHome = () => {
    const buttons = [
      { text: prefs.home ? t("settings.home.useCurrentInstead") : t("settings.home.useCurrent"), onPress: () => void useHereAsHome() },
      ...(prefs.home ? [{ text: t("settings.home.forget"), style: "destructive" as const, onPress: () => setHomeLocation(null) }] : []),
      { text: t("common.cancel"), style: "cancel" as const },
    ];
    Alert.alert(t("settings.home.title"), t("settings.home.explain", { radius: HOME_RADIUS_M }), buttons);
  };
  // Development builds only: the screenshot dataset, built for today, replacing everything (lib/demo.ts).
  // Required here rather than imported, so a release build never bundles the dataset.
  const [loadingDemo, setLoadingDemo] = useState(false);
  const askDemo = () => Alert.alert(t("settings.about.testDataTitle"), t("settings.about.testDataBody"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("settings.about.testDataAction"), style: "destructive", onPress: () => {
      if (!__DEV__) return;
      setLoadingDemo(true);
      const { loadDemoData } = require("@/lib/demo") as typeof import("@/lib/demo"); // eslint-disable-line @typescript-eslint/no-require-imports
      void loadDemoData()
        .then((r) => Alert.alert(t("settings.about.testDataDone"), r.safety ? `${r.summary}\n\n${t("settings.about.testDataSafety", { name: r.safety })}` : r.summary))
        .catch((e: Error) => Alert.alert(t("settings.about.testDataFailed"), e.message))
        .finally(() => setLoadingDemo(false));
    } },
  ]);
  // One row leads to /settings/data, so its subtitle answers the question that screen is usually
  // opened for — when the last backup ran — and falls back to what else lives there.
  const inventory = t("settings.data.inventory", { count: counts.tx });
  const backupLine = !backup.supported ? inventory
    : backup.busy ? t("settings.data.backingUp")
    : backup.error ? t("settings.data.failed", { error: backup.error })
    : !backup.enabled ? t("settings.data.off", { inventory })
    : backup.last ? (backup.icloud ? lastBackupLine(backup.last.at) : t("settings.data.local", { last: lastBackupLine(backup.last.at) }))
    : t("settings.data.none", { inventory });
  const tripSubtitle = !tripStats ? t("settings.travel.off")
    : tripStats.days_left === 0 && trip?.ends ? t("settings.travel.onPlanned", { trip: tripLine(tripStats), date: humanDayTime(trip.ends) })
    : t("settings.travel.on", { trip: tripLine(tripStats) });
  const startDaySubtitle = prefs.startDay === 1 ? t("settings.startDay.calendar")
    : t("settings.startDay.custom", { ordinal: ordinal(prefs.startDay), from: dayMonth(prefs.startDay, 8), to: dayMonth(prefs.startDay - 1, 9) });

  return (
    <>
      <Stack.Screen options={{ title: t("settings.title"), headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <SectionHeader>{t("settings.section.tracking")}</SectionHeader>
        <Card>
          <Row icon="creditcard" title={t("settings.accounts.title")} subtitle={t("settings.accounts.subtitle", { count: counts.accounts })} onPress={() => router.push("/settings/accounts")} />
          <Row icon="folder" iconColor="#FF9F0A" title={t("settings.categories.title")} subtitle={t("settings.categories.subtitle", { count: counts.categories })} onPress={() => router.push("/settings/categories")} style={styles.divider} />
          <Row icon="number" iconColor="#5E5CE6" title={t("settings.tags.title")} subtitle={t("settings.tags.subtitle", { count: counts.tags })} onPress={() => router.push("/settings/tags")} style={styles.divider} />
          <Row icon="repeat" iconColor="#30D158" title={t("settings.recurring.title")} subtitle={t("settings.recurring.subtitle", { count: counts.recurring })} onPress={() => router.push("/settings/recurring")} style={styles.divider} />
          <Row icon="arrow.left.arrow.right.circle" iconColor="#FF9500" title={t("settings.debts.title")} subtitle={debtSubtitle} onPress={() => router.push("/settings/debts")} style={styles.divider} />
          {/* Its own screen: starting, changing, ending and looking back at trips all live there. */}
          <Row icon="airplane" iconColor="#0A84FF" title={t("settings.travel.title")} style={styles.divider} onPress={() => router.push("/settings/travel")}
            subtitle={tripSubtitle} />
        </Card>
        <SectionHeader>{t("settings.section.preferences")}</SectionHeader>
        <Card>
          <Row icon="globe" iconColor="#0A84FF" title={t("common.language.title")} subtitle={languageLine} onPress={pickLanguage} />
          <Row icon="paintpalette" iconColor="#AF52DE" title={t("theme.title")} subtitle={appearance ? `${themeName(getTheme())} · ${appearanceName(appearance)}` : themeName(getTheme())} onPress={() => router.push("/settings/theme")} style={styles.divider} />
          <Row icon="calendar" iconColor="#FF9F0A" title={t("settings.startDay.title")} subtitle={startDaySubtitle} onPress={pickDay} style={styles.divider} />
          <ToggleRow icon="eye.slash" iconColor="#8E8E93" title={t("settings.hideIncome.title")} subtitle={prefs.hideIncome ? t("settings.hideIncome.on") : t("settings.hideIncome.off")} value={prefs.hideIncome} onChange={setHideIncome} style={styles.divider} />
          <ToggleRow icon="eye" iconColor="#0A84FF" title={t("settings.showBalance.title")} subtitle={prefs.showBalance ? t("settings.showBalance.on") : t("settings.showBalance.off")} value={prefs.showBalance} onChange={setShowBalance} style={styles.divider} />
        </Card>
        {/* Location on its own: the switch, and the one place it never suggests anything. */}
        <SectionHeader>{t("settings.section.location")}</SectionHeader>
        <Card>
          <ToggleRow icon="location" iconColor="#34C759" title={t("settings.location.title")} subtitle={perm.loc === "denied" ? t("settings.location.denied") : t("settings.location.on")} value={prefs.location && perm.loc === "granted"} onChange={(v) => void toggleLocation(v)} />
          {prefs.location && perm.loc === "granted" ? (
            <Row icon="house" iconColor="#34C759" title={t("settings.home.title")} style={styles.divider} onPress={settingHome ? undefined : pickHome}
              subtitle={settingHome ? t("settings.home.reading") : prefs.home ? t("settings.home.set", { place: prefs.home.place ?? `${prefs.home.lat.toFixed(4)}, ${prefs.home.lon.toFixed(4)}` }) : t("settings.home.unset")} />
          ) : null}
        </Card>
        <SectionHeader>{t("settings.section.backup")}</SectionHeader>
        <Card>
          <Row icon="externaldrive" iconColor="#8E8E93" title={t("settings.data.title")} subtitle={backupLine} onPress={() => router.push("/settings/data")} />
        </Card>
        <SectionHeader>{t("settings.section.shortcuts")}</SectionHeader>
        <Card>
          <Row icon="bell.badge" iconColor="#FF9F0A" title={t("settings.shortcut.title")} badge={t("settings.shortcut.beta")}
            subtitle={AUTOMATION_SUPPORTED ? t("settings.shortcut.subtitle") : t("settings.shortcut.subtitleOld", { version: AUTOMATION_MIN_IOS })} onPress={() => router.push("/settings/shortcut")} />
          {/* No count of unread notifications here: the log is one tap away for whoever wants to look,
              and a warning on the settings screen for every odd bank message was nagging. */}
          <Row icon="slider.horizontal.3" iconColor="#5E5CE6" title={t("settings.shortcut.settings")} subtitle={t("settings.shortcut.settingsSubtitle")}
            onPress={() => router.push("/settings/automation")} style={styles.divider} />
        </Card>
        {/* Not a shortcut, so not in their card: the notes show themselves once after an update, and this is how you find them again. */}
        <SectionHeader>{t("settings.section.about")}</SectionHeader>
        <Card>
          <Row icon="hand.raised" iconColor="#8E8E93" title={t("settings.about.privacy")} subtitle={t("settings.about.privacySubtitle")}
            onPress={() => { void Linking.openURL(privacyPolicyUrl()); }} />
          {/* No notes (a first release has nothing to be new against) means no row: the sheet would open empty. */}
          {releasesToRead().length ? <Row icon="sparkles" iconColor="#8E8E93" title={t("settings.about.whatsNew")} subtitle={t("settings.about.whatsNewSubtitle", { version: APP_MARKETING_VERSION })} onPress={() => router.push("/whats-new")} style={styles.divider} /> : null}
          {/* Boot trace and the last JS crash: useful while developing, noise in a shipped build. The version lives in the footer instead. */}
          {__DEV__ ? <Row icon="stethoscope" iconColor="#8E8E93" title={t("settings.about.diagnostics")} subtitle={t("settings.about.diagnosticsSubtitle")} onPress={() => router.push("/settings/diagnostics")} style={styles.divider} /> : null}
          {__DEV__ ? <Row icon="tray.and.arrow.down" iconColor="#8E8E93" title={t("settings.about.testData")} subtitle={loadingDemo ? t("settings.about.testDataLoading") : t("settings.about.testDataSubtitle")} onPress={loadingDemo ? undefined : askDemo} style={styles.divider} /> : null}
        </Card>
        <Text style={styles.foot}>{backup.enabled && backup.icloud ? t("settings.footICloud") : t("settings.foot")}</Text>
        <Text style={styles.version} selectable>{t("settings.version", { version: APP_VERSION })}</Text>
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  foot: { color: C.tertiary, fontSize: 13, textAlign: "center", marginTop: S.xxl, paddingHorizontal: S.xl },
  version: { color: C.tertiary, fontSize: 12, textAlign: "center", marginTop: S.sm, fontVariant: ["tabular-nums"] },
}));
