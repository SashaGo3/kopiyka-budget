import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { HOME_RADIUS_M, debtTotals, eraseAll, formatMinor, listDebts, listRows } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { getPeriodStartDay, setPeriodStartDay } from "@/lib/period";
import { notifyChange } from "@/store";
import { C, S } from "@/constants/theme";
import { APP_VERSION } from "@/constants/app";
import { lastBackupLine, useBackupState } from "@/lib/backup";
import { getHideIncome, getHomeLocation, getLocationEnabled, getShowBalance, setHideIncome, setHomeLocation, setLocationEnabled, setShowBalance } from "@/lib/settings";
import { ensureLocationPermission, locationStatus, placeName, preciseLocation } from "@/lib/location";
import { ensureNotificationPermission, notificationStatus } from "@/lib/notifications";
import { endTravel, tripLine, useActiveTrip, useTripStats } from "@/lib/travel";
import { humanDayTime } from "@/lib/dates";
import { parseLogCount } from "@/lib/parselog";
import { LANGUAGES, getLanguage, isFollowingDevice, setLanguage, useT, type Language } from "@/i18n";

const ordinal = (d: number) => `${d}${d === 1 || d === 21 ? "st" : d === 2 || d === 22 ? "nd" : d === 3 || d === 23 ? "rd" : "th"}`;

/** "3 transactions, 1 account and 47 categories" — empty kinds are left out, so a fresh phone does not
 *  get told it is about to lose "0 tags". Returns "" when there is nothing to count. */
function countList(parts: [number, string, string?][]): string {
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many ?? `${one}s`}`);
  if (said.length < 2) return said[0] ?? "";
  return `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

export default function SettingsScreen() {
  const t = useT();
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
    if (!counts.debts) return "Nothing owed either way";
    const base = `${counts.debts} open`;
    if (!counts.debtNet) return base;
    const diff = counts.debtNet.owed_to_me_minor - counts.debtNet.i_owe_minor;
    if (!diff) return base;
    return `${base} · ${formatMinor(Math.abs(diff), counts.debtNet.currency)} ${counts.debtNet.currency} ${diff > 0 ? "owed to you" : "you owe"}`;
  })();
  const keys = useMemo(() => ({ day: newPickKey("startday"), custom: newPickKey("startcustom"), lang: newPickKey("lang") }), []);
  // "auto" is not a language but the absence of a choice: the app keeps following the phone, so
  // someone who switches their iPhone to Polish gets Polish here too without coming back.
  const language = useQuery(() => ({ code: getLanguage(), auto: isFollowingDevice() }));
  usePickResult<string>(keys.lang, useCallback((v: string) => { setLanguage(v === "auto" ? null : (v as Language)); notifyChange(); }, []));
  const pickLanguage = () => router.push({ pathname: "/pick/option", params: { key: keys.lang, title: t("Language"), selected: language.auto ? "auto" : language.code,
    options: JSON.stringify([
      { value: "auto", label: t("Match my phone"), subtitle: LANGUAGES.find((l) => l.code === getLanguage())?.name },
      ...LANGUAGES.map((l) => ({ value: l.code, label: l.name, subtitle: t(l.english) })),
    ]) } });
  const setDay = useCallback((v: string) => { setPeriodStartDay(Number(v)); notifyChange(); }, []);
  usePickResult<string>(keys.custom, setDay);
  usePickResult<string>(keys.day, useCallback((v: string) => {
    if (v !== "custom") { setDay(v); return; }
    // The first sheet is still dismissing when this runs; push the next one once it is gone.
    setTimeout(() => router.push({ pathname: "/pick/option", params: { key: keys.custom, title: "Day of month", selected: String(getPeriodStartDay()),
      options: JSON.stringify(Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }))) } }), 450);
  }, [keys.custom, setDay]));
  const pickDay = () => router.push({ pathname: "/pick/option", params: { key: keys.day, title: "Budget month starts on", selected: prefs.startDay === 1 || prefs.startDay === 15 ? String(prefs.startDay) : "custom",
    options: JSON.stringify([{ value: "1", label: "1st", subtitle: "Calendar month" }, { value: "15", label: "15th", subtitle: "Salary in the middle of the month" }, { value: "custom", label: "Custom…", subtitle: prefs.startDay !== 1 && prefs.startDay !== 15 ? `Currently the ${ordinal(prefs.startDay)}` : "Any day up to the 28th" }]) } });
  const trip = useActiveTrip();
  const tripStats = useTripStats(trip);
  const toggleTravel = (on: boolean) => {
    if (on) { if (!trip) router.push("/travel/start"); return; }
    if (!trip || !tripStats) return;
    const s = tripStats;
    Alert.alert(`End the trip to ${s.name}?`, `${tripLine(s)}. New expenses stop getting the “${s.name}” tag; the trip stays in Budgets as history.`, [
      { text: "Keep travelling", style: "cancel" },
      { text: "End trip", style: "destructive", onPress: () => endTravel(trip.id) },
    ]);
  };
  // Permissions: iOS state is read on every focus (the user may come back from the Settings app).
  const [perm, setPerm] = useState<{ notif: "granted" | "denied" | "undetermined"; loc: "granted" | "denied" | "undetermined" }>({ notif: "undetermined", loc: "undetermined" });
  const refreshPerm = useCallback(() => { void Promise.all([notificationStatus(), locationStatus()]).then(([notif, loc]) => setPerm({ notif, loc })); }, []);
  useEffect(refreshPerm, [refreshPerm]);
  useFocusEffect(refreshPerm);
  // The automation writes to a file with the app closed, so this is re-read on arrival rather than
  // being part of the store. Counting lines, not decoding them: the row only needs "how many".
  const [missedNotifications, setMissed] = useState(0);
  useFocusEffect(useCallback(() => { setMissed(parseLogCount()); }, []));
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
      if (!c) { Alert.alert("No location yet", "The phone has not got a fix yet. Try again in a moment, somewhere with a clearer view of the sky."); return; }
      setHomeLocation({ ...c, place: await placeName(c) });
    } finally { setSettingHome(false); }
  };
  const pickHome = () => {
    const buttons = [
      { text: prefs.home ? "Use current location instead" : "Use current location", onPress: () => void useHereAsHome() },
      ...(prefs.home ? [{ text: "Forget home", style: "destructive" as const, onPress: () => setHomeLocation(null) }] : []),
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert("Home", `No category is suggested within ${HOME_RADIUS_M} m of home, since anything gets bought there.`, buttons);
  };
  const toggleNotifications = async (on: boolean) => {
    if (!on || perm.notif === "denied") { void Linking.openSettings(); return; }   // only the Settings app can revoke
    await ensureNotificationPermission();
    refreshPerm();
  };
  // Erasing asks twice. The first tap is easy to make by accident on a row like this one; the second
  // prompt counts out loud what is about to go, so agreeing to it takes actually reading the numbers.
  const confirmReset = () => {
    const doomed = countList([[counts.tx, "transaction"], [counts.accounts, "account"], [counts.categories, "category", "categories"], [counts.tags, "tag"]]);
    Alert.alert("Last chance", doomed ? `${doomed} will be deleted from this phone.` : "Everything on this phone will be deleted.", [
      { text: "Keep my data", style: "cancel" },
      // A wiped phone is a first launch again: eraseAll clears the `onboarded` flag, and the welcome
      // flow replaces the tabs so the user is not left on an empty Settings screen.
      { text: "Erase everything", style: "destructive", onPress: () => { mutate((d) => eraseAll(d, { everywhere: false })); router.replace("/onboarding"); } },
    ]);
  };
  const resetAll = () => Alert.alert("Erase this phone?", "This cannot be undone. iCloud backups are kept; you can restore one afterwards.", [
    { text: "Cancel", style: "cancel" },
    // The first alert has to finish dismissing before the second opens, or iOS drops it (same as pickDay).
    { text: "Erase", style: "destructive", onPress: () => setTimeout(confirmReset, 350) },
  ]);

  // One row leads to /settings/data, so its subtitle answers the question that screen is usually
  // opened for — when the last backup ran — and falls back to what else lives there.
  const inventory = `${counts.tx} transactions · export, import, storage`;
  const backupLine = !backup.supported ? inventory
    : backup.busy ? "Backing up…"
    : backup.error ? `Backup failed: ${backup.error}`
    : !backup.enabled ? `Backup off · ${inventory}`
    : backup.last ? `${lastBackupLine(backup.last.at)}${backup.icloud ? "" : " · iCloud is off, kept on this phone"}`
    : `No backup yet · ${inventory}`;

  return (
    <>
      <Stack.Screen options={{ title: "Settings", headerLargeTitle: true }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <SectionHeader>Tracking</SectionHeader>
        <Card>
          <Row icon="creditcard" title="Accounts" subtitle={`${counts.accounts} · net worth and balances`} onPress={() => router.push("/settings/accounts")} />
          <Row icon="folder" iconColor="#FF9F0A" title="Categories" subtitle={`${counts.categories} · folders and categories`} onPress={() => router.push("/settings/categories")} style={styles.divider} />
          <Row icon="number" iconColor="#5E5CE6" title="Tags" subtitle={`${counts.tags} · optionally per category`} onPress={() => router.push("/settings/tags")} style={styles.divider} />
          <Row icon="repeat" iconColor="#30D158" title="Recurring" subtitle={`${counts.recurring} active`} onPress={() => router.push("/settings/recurring")} style={styles.divider} />
          <Row icon="arrow.left.arrow.right.circle" iconColor="#FF9500" title="Debts" subtitle={debtSubtitle} onPress={() => router.push("/settings/debts")} style={styles.divider} />
          <ToggleRow icon="airplane" iconColor="#0A84FF" title="Travel mode" value={!!trip} onChange={toggleTravel} style={styles.divider}
            subtitle={tripStats ? `${tripLine(tripStats)}${tripStats.days_left === 0 && trip?.ends ? ` · planned until ${humanDayTime(trip.ends)}` : ""}` : "Tag every new expense and track a trip budget"} />
        </Card>
        <SectionHeader>{t("Preferences")}</SectionHeader>
        <Card>
          <Row icon="globe" iconColor="#5E5CE6" title={t("Language")} subtitle={language.auto ? t("Following your phone · {name}", { name: LANGUAGES.find((l) => l.code === language.code)?.name ?? "" }) : LANGUAGES.find((l) => l.code === language.code)?.name} onPress={pickLanguage} />
          <Row style={styles.divider} icon="calendar" iconColor="#FF9F0A" title="Budget month starts on" subtitle={prefs.startDay === 1 ? "1st · calendar month" : `${ordinal(prefs.startDay)} · e.g. ${prefs.startDay} Aug – ${prefs.startDay - 1} Sep`} onPress={pickDay} />
          <ToggleRow icon="bell.badge" iconColor="#FF3B30" title="Notifications" subtitle={perm.notif === "granted" ? "Reminders for recurring transactions" : perm.notif === "denied" ? "Turned off in the Settings app" : "Reminders before recurring payments are due"} value={perm.notif === "granted"} onChange={(v) => void toggleNotifications(v)} style={styles.divider} />
          <ToggleRow icon="eye.slash" iconColor="#8E8E93" title="Hide income" subtitle={prefs.hideIncome ? "Transactions shows expenses and transfers only" : "Show income in the Transactions list"} value={prefs.hideIncome} onChange={setHideIncome} style={styles.divider} />
          <ToggleRow icon="eye" iconColor="#0A84FF" title="Show balance when logging" subtitle={prefs.showBalance ? "The new-entry sheet opens with the balance before and after" : "Folded behind the chevron until you tap it"} value={prefs.showBalance} onChange={setShowBalance} style={styles.divider} />
          <ToggleRow icon="location" iconColor="#34C759" title="Remember location" subtitle={perm.loc === "denied" ? "Turned off in the Settings app" : "Suggests the category you used at the same place"} value={prefs.location && perm.loc === "granted"} onChange={(v) => void toggleLocation(v)} style={styles.divider} />
          {prefs.location && perm.loc === "granted" ? (
            <Row icon="house" iconColor="#34C759" title="Home" style={styles.divider} onPress={settingHome ? undefined : pickHome}
              subtitle={settingHome ? "Reading location…" : prefs.home ? `${prefs.home.place ?? `${prefs.home.lat.toFixed(4)}, ${prefs.home.lon.toFixed(4)}`} · no suggestions here` : "Not set · skip category suggestions at home"} />
          ) : null}
        </Card>
        <SectionHeader>Backup</SectionHeader>
        <Card>
          <Row icon="externaldrive" iconColor="#8E8E93" title="Data management" subtitle={backupLine} onPress={() => router.push("/settings/data")} />
        </Card>
        <SectionHeader>Shortcuts</SectionHeader>
        <Card>
          {/* First, and only when there is something in it: a notification the automation could not
              read is a purchase that may be missing, and nothing else says so. */}
          {missedNotifications ? (
            <Row icon="exclamationmark.triangle" iconColor="#FF453A" title="Notification log"
              subtitle={`${missedNotifications} notification${missedNotifications === 1 ? "" : "s"} could not be turned into a transaction`}
              onPress={() => router.push("/settings/parselog")} style={styles.divider} />
          ) : null}
          <Row icon="bell.badge" iconColor="#FF9F0A" title="Automate with Shortcut" subtitle="Log payments from your bank's or Wallet's notifications" onPress={() => router.push("/settings/shortcut")} style={missedNotifications ? styles.divider : undefined} />
          {/* Boot trace and the last JS crash: useful while developing, noise in a shipped build. The version lives in the footer instead. */}
          {__DEV__ ? <Row icon="stethoscope" iconColor="#8E8E93" title="Diagnostics" subtitle="Boot trace and the last recorded crash" onPress={() => router.push("/settings/diagnostics")} style={styles.divider} /> : null}
        </Card>
        {/* Its own section: a headerless card straight under Shortcuts read as one more shortcut. */}
        <SectionHeader>Start over</SectionHeader>
        <Card>
          <Row icon="trash" iconColor="#FF3B30" title="Reset all data" subtitle="Delete every account, category, tag, budget and transaction" destructive onPress={resetAll} />
        </Card>
        <Text style={styles.foot}>Local-first. Your data lives on this phone{backup.enabled && backup.icloud ? ", with backups in your iCloud Drive" : ""}.</Text>
        <Text style={styles.version} selectable>Kopiyka Budget {APP_VERSION}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  foot: { color: C.tertiary, fontSize: 13, textAlign: "center", marginTop: S.xxl, paddingHorizontal: S.xl },
  version: { color: C.tertiary, fontSize: 12, textAlign: "center", marginTop: S.sm, fontVariant: ["tabular-nums"] },
});
