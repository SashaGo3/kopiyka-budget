import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Card, Row, SectionHeader } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { AUTOMATION_MIN_IOS, AUTOMATION_SUPPORTED, IOS_VERSION } from "@/constants/features";
import { t } from "@/i18n";

/** Setup steps, worded as what you actually tap, in the order the Shortcuts app puts them in. */
const steps = (): { title: string; subtitle: string }[] => [
  { title: t("automation.shortcut.step1"), subtitle: t("automation.shortcut.step1Sub") },
  { title: t("automation.shortcut.step2"), subtitle: t("automation.shortcut.step2Sub") },
  { title: t("automation.shortcut.step3"), subtitle: t("automation.shortcut.step3Sub") },
  { title: t("automation.shortcut.step4"), subtitle: t("automation.shortcut.step4Sub") },
  { title: t("automation.shortcut.step5"), subtitle: t("automation.shortcut.step5Sub") },
  { title: t("automation.shortcut.step6"), subtitle: t("automation.shortcut.step6Sub") },
];

/**
 * Card payments are not an API: iOS never hands Wallet transactions to apps, and iOS 26 dropped the
 * Shortcuts "Transaction" trigger that used to stand in for one. What is left is the notification
 * automation — the bank already tells you about the payment, and Shortcuts can pass the whole
 * notification on as one variable. The reading itself is native/KPPaymentText.swift and the filing
 * native/KopiykaIntents.swift; this screen only explains the setup.
 */
export default function ShortcutScreen() {
  const openShortcuts = () => {
    Linking.openURL("shortcuts://").catch(() => Alert.alert(t("automation.shortcut.unavailableTitle"), t("automation.shortcut.unavailableMessage")));
  };

  return (
    <>
      <Stack.Screen options={{ title: t("automation.shortcut.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={styles.intro}>{t("automation.shortcut.intro")}</Text>

        <View style={[styles.need, !AUTOMATION_SUPPORTED && styles.needStrong]}>
          <SymbolView name={AUTOMATION_SUPPORTED ? "info.circle" : "exclamationmark.triangle.fill"} size={18} tintColor={AUTOMATION_SUPPORTED ? C.secondary : C.orange} />
          <Text style={[styles.needText, !AUTOMATION_SUPPORTED && { color: C.label }]}>
            {AUTOMATION_SUPPORTED
              ? t("automation.shortcut.needs", { version: AUTOMATION_MIN_IOS })
              : IOS_VERSION ? t("automation.shortcut.needsOld", { version: AUTOMATION_MIN_IOS, current: IOS_VERSION }) : t("automation.shortcut.needsUnknown", { version: AUTOMATION_MIN_IOS })}
          </Text>
        </View>

        <SectionHeader>{t("automation.shortcut.setUp")}</SectionHeader>
        <Card>
          {steps().map((s, i) => (
            <View key={s.title} style={[styles.step, i ? styles.divider : undefined]}>
              <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepSub}>{s.subtitle}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ marginTop: S.lg }}>
          <Row icon="arrow.up.forward.app" title={t("automation.shortcut.open")} onPress={openShortcuts} />
        </Card>

        <SectionHeader>{t("automation.shortcut.expect")}</SectionHeader>
        <Card>
          <Row icon="hourglass" iconColor="#FF9F0A" title={t("automation.shortcut.pending")} subtitle={t("automation.shortcut.pendingSub")} />
          <Row icon="wand.and.stars" iconColor="#30D158" title={t("automation.shortcut.known")} subtitle={t("automation.shortcut.knownSub")} style={styles.divider} />
          <Row icon="creditcard" iconColor="#0A84FF" title={t("automation.shortcut.account")} subtitle={t("automation.shortcut.accountSub")} style={styles.divider} />
          <Row icon="line.3.horizontal.decrease.circle" iconColor="#8E8E93" title={t("automation.shortcut.only")} subtitle={t("automation.shortcut.onlySub")} style={styles.divider} />
          <Row icon="slider.horizontal.3" iconColor="#5E5CE6" title={t("automation.shortcut.settings")} subtitle={t("automation.shortcut.settingsSub")} onPress={() => router.push("/settings/automation")} style={styles.divider} />
        </Card>

        <Text style={styles.hint}>{t("automation.shortcut.hint")}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  intro: { color: C.secondary, fontSize: 15, lineHeight: 21, paddingHorizontal: S.xl, marginTop: S.md },
  need: { flexDirection: "row", alignItems: "flex-start", gap: S.sm, marginHorizontal: S.lg, marginTop: S.md, padding: S.md, borderRadius: R.card, backgroundColor: C.card },
  needStrong: { backgroundColor: "rgba(255,159,10,0.16)" },
  needText: { flex: 1, color: C.secondary, fontSize: 14, lineHeight: 19 },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.lg },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  step: { flexDirection: "row", alignItems: "flex-start", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  num: { width: 24, height: 24, borderRadius: R.sm, backgroundColor: C.tint, alignItems: "center", justifyContent: "center" },
  numText: { color: C.onTint, fontSize: 13, fontWeight: "600" },
  stepTitle: { color: C.label, fontSize: 16 },
  stepSub: { color: C.secondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
});
