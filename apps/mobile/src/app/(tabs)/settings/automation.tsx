import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { useQuery } from "@/store";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { getShortcutNotify, setShortcutNotify } from "@/lib/settings";
import { ensureNotificationPermission, notificationStatus, syncBadge } from "@/lib/notifications";
import { parseLogCount } from "@/lib/parselog";

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
    ? "It logs the payment and says nothing"
    : perm === "granted" ? "One notification per payment, replacing the last one"
    : perm === "denied" ? "Notifications are off in the Settings app, so it stays silent"
    : "Allow notifications and it will say what it logged";

  return (
    <>
      <Stack.Screen options={{ title: "Shortcut settings" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <SectionHeader>When it logs a payment</SectionHeader>
        <Card>
          <ToggleRow icon="bell.badge" iconColor="#FF9F0A" title="Tell me" subtitle={notifySubtitle} value={notify} onChange={(v) => void toggle(v)} />
          {notify && perm === "denied" ? (
            <Row icon="gear" iconColor="#8E8E93" title="Open the Settings app" subtitle="Notifications are turned off for Kopiyka" onPress={() => void Linking.openSettings()} style={styles.divider} />
          ) : null}
        </Card>
        <Text style={styles.hint}>
          Only one is ever on screen: a new payment takes the place of the one before it, so a busy Saturday does not leave a pile of them. Tapping opens the entry itself — the amount, the shop, the account and the category it was filed under, with “guess” when nobody has agreed to that category yet. The number on the app icon is how many entries are waiting to be approved.
        </Text>
        <SectionHeader>When it gets one wrong</SectionHeader>
        <Card>
          <Row icon={missed ? "exclamationmark.triangle" : "doc.text.magnifyingglass"} iconColor={missed ? "#FF453A" : "#0A84FF"} title="Notification log"
            subtitle={missed ? `${missed} notification${missed === 1 ? "" : "s"} could not be turned into a transaction` : "Nothing it could not read"}
            onPress={() => router.push("/settings/parselog")} />
        </Card>
        <Text style={styles.hint}>
          A bank whose wording it does not know yet loses purchases quietly, so the ones it could not use are kept here — with the text, which is the only way to fix the reading afterwards. Exports as CSV.
        </Text>
        <SectionHeader>Setting it up</SectionHeader>
        <Card>
          <Row icon="bell.badge" iconColor="#FF9F0A" title="Automate with Shortcut" subtitle="The seven steps, and what to expect from it" onPress={() => router.push("/settings/shortcut")} />
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, lineHeight: 18, paddingHorizontal: S.xl, paddingTop: S.sm },
});
