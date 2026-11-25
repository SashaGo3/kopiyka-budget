import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { useQuery } from "@/store";
import { Card, Footnote, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { C, themed } from "@/constants/theme";
import { DEFAULT_PENDING_REMINDER, getPendingReminder, getShortcutNotify, setPendingReminder, setShortcutNotify } from "@/lib/settings";
import { newPickKey, usePickResult } from "@/store/pick";
import { ensureNotificationPermission, notificationStatus, syncBadge } from "@/lib/notifications";
import { parseLogCount } from "@/lib/parselog";
import { t } from "@/i18n";

/**
 * What the Shortcut automation does once it is set up — as opposed to how to set it up, which is
 * `shortcut.tsx`. Two questions live here: whether it says anything when it logs a payment, and
 * what it could not read (the notification log, which used to sit on the Settings root and only
 * when it was non-empty) — and the evening reminder about whatever it left waiting in Pending.
 */
export default function AutomationSettings() {
  const notify = useQuery(() => getShortcutNotify());
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined">("undetermined");
  const refresh = useCallback(() => { void notificationStatus().then(setPerm); }, []);
  useEffect(refresh, [refresh]);
  useFocusEffect(refresh);
  const evening = useQuery(() => getPendingReminder());
  const timeKey = useMemo(() => newPickKey("eveningtime"), []);
  usePickResult<string>(timeKey, setPendingReminder);
  const toggleEvening = async (on: boolean) => {
    setPendingReminder(on ? DEFAULT_PENDING_REMINDER : null);
    if (!on) return;
    if (perm === "denied") { void Linking.openSettings(); return; }
    await ensureNotificationPermission();
    refresh();
  };
  const [missed, setMissed] = useState(0);
  useFocusEffect(useCallback(() => { setMissed(parseLogCount()); }, []));

  // Turning it on is also the moment to ask for the permission it needs: the automation itself runs
  // in the background off a notification, where a prompt would have nobody in front of it.
  const toggle = async (on: boolean) => {
    setShortcutNotify(on);
    if (!on) return;
    if (perm === "denied") { void Linking.openSettings(); return; }
    await ensureNotificationPermission();
    refresh();
    void syncBadge();
  };

  const notifySubtitle = !notify
    ? t("automation.settings.silent")
    : perm === "granted" ? t("automation.settings.granted")
    : perm === "denied" ? t("automation.settings.denied")
    : t("automation.settings.ask");

  return (
    <>
      <Stack.Screen options={{ title: t("automation.settings.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <SectionHeader>{t("automation.settings.whenLogs")}</SectionHeader>
        <Card>
          <ToggleRow icon="bell.badge" iconColor="#FF9F0A" title={t("automation.settings.tellMe")} subtitle={notifySubtitle} value={notify} onChange={(v) => void toggle(v)} />
          {notify && perm === "denied" ? (
            <Row icon="gear" iconColor="#8E8E93" title={t("automation.settings.openSettings")} subtitle={t("automation.settings.openSettingsSubtitle")} onPress={() => void Linking.openSettings()} style={styles.divider} />
          ) : null}
        </Card>
        <Footnote more={t("automation.settings.notifyMore")}>{t("automation.settings.notifyShort")}</Footnote>
        <SectionHeader>{t("automation.settings.whilePending")}</SectionHeader>
        <Card>
          <ToggleRow icon="moon" iconColor="#5E5CE6" title={t("automation.settings.evening")}
            subtitle={evening ? t("automation.settings.eveningOn", { time: evening }) : t("automation.settings.eveningOff")}
            value={!!evening} onChange={(v) => void toggleEvening(v)} />
          {evening ? (
            <Row icon="clock" iconColor="#8E8E93" title={t("automation.settings.eveningTime")} style={styles.divider}
              right={<Text style={styles.value}>{evening}</Text>}
              onPress={() => router.push({ pathname: "/pick/time", params: { key: timeKey, selected: evening } })} />
          ) : null}
        </Card>
        <Footnote>{t("automation.settings.eveningShort")}</Footnote>
        <SectionHeader>{t("automation.settings.whenWrong")}</SectionHeader>
        <Card>
          <Row icon="doc.text.magnifyingglass" iconColor="#0A84FF" title={t("automation.settings.log")}
            subtitle={missed ? t("automation.settings.logMissed", { count: missed }) : t("automation.settings.logNone")}
            onPress={() => router.push("/settings/parselog")} />
        </Card>
        <Footnote more={t("automation.settings.logHintMore")}>{t("automation.settings.logHintShort")}</Footnote>
        <SectionHeader>{t("automation.settings.setup")}</SectionHeader>
        <Card>
          <Row icon="bell.badge" iconColor="#FF9F0A" title={t("automation.settings.automate")} subtitle={t("automation.settings.automateSubtitle")} onPress={() => router.push("/settings/shortcut")} />
        </Card>
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  value: { fontSize: 17, color: C.secondary, fontVariant: ["tabular-nums"] },
}));
