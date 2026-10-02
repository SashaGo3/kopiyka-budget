import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { useQuery } from "@/store";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { getShortcutNotify, setShortcutNotify } from "@/lib/settings";
import { ensureNotificationPermission, notificationStatus, syncBadge } from "@/lib/notifications";
import { parseLogCount } from "@/lib/parselog";
import { t } from "@/i18n";

/**
 * What the Shortcut automation does once it is set up — as opposed to how to set it up, which is
 * `shortcut.tsx`. Two questions live here: whether it says anything when it logs a payment, and
 * what it could not read (the notification log, which used to sit on the Settings root and only
 * when it was non-empty).
 */
export default function AutomationSettings() {
  const notify = useQuery(() => getShortcutNotify());
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined">("undetermined");
  const refresh = useCallback(() => { void notificationStatus().then(setPerm); }, []);
  useEffect(refresh, [refresh]);
  useFocusEffect(refresh);
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
        <Text style={styles.hint}>{t("automation.settings.hintNotify")}</Text>
        <SectionHeader>{t("automation.settings.whenWrong")}</SectionHeader>
        <Card>
          <Row icon="doc.text.magnifyingglass" iconColor="#0A84FF" title={t("automation.settings.log")}
            subtitle={missed ? t("automation.settings.logMissed", { count: missed }) : t("automation.settings.logNone")}
            onPress={() => router.push("/settings/parselog")} />
        </Card>
        <Text style={styles.hint}>{t("automation.settings.hintLog")}</Text>
        <SectionHeader>{t("automation.settings.setup")}</SectionHeader>
        <Card>
          <Row icon="bell.badge" iconColor="#FF9F0A" title={t("automation.settings.automate")} subtitle={t("automation.settings.automateSubtitle")} onPress={() => router.push("/settings/shortcut")} />
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, lineHeight: 18, paddingHorizontal: S.xl, paddingTop: S.sm },
});
