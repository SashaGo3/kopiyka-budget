import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Card, Row, SectionHeader } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { AUTOMATION_MIN_IOS, AUTOMATION_SUPPORTED, IOS_VERSION } from "@/constants/features";

/** Setup steps, worded as what you actually tap, in the order the Shortcuts app puts them in. */
const STEPS: { title: string; subtitle: string }[] = [
  { title: "Shortcuts → Automation → +", subtitle: "The Automation tab, then + in the top right." },
  { title: "“When I receive a notification”", subtitle: "Pick your bank’s app. No bank notifications? Pick Wallet (Apple Pay). Both is fine." },
  { title: "Add a filter, choose Run Immediately", subtitle: "A word every payment notification has, like “Amount”. Turn off “Notify When Run”." },
  { title: "Add “Log payment from an app notification”", subtitle: "Search for it; it is under Kopiyka Budget." },
  { title: "Put Notification in its field", subtitle: "Tap the field → Select Variable → Notification." },
  { title: "Optional: where you paid", subtitle: "Add “Get Current Location” above it, then pass it to Location under Show More." },
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
    Linking.openURL("shortcuts://").catch(() => Alert.alert("Shortcuts not available", "Install the Shortcuts app from the App Store, then come back."));
  };

  return (
    <>
      <Stack.Screen options={{ title: "Automate with Shortcut" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={styles.intro}>
          Your bank already notifies you about every payment. Pass that notification to Kopiyka and it logs the payment for you. Set it up once.
        </Text>

        <View style={[styles.need, !AUTOMATION_SUPPORTED && styles.needStrong]}>
          <SymbolView name={AUTOMATION_SUPPORTED ? "info.circle" : "exclamationmark.triangle.fill"} size={18} tintColor={AUTOMATION_SUPPORTED ? C.secondary : C.orange} />
          <Text style={[styles.needText, !AUTOMATION_SUPPORTED && { color: C.label }]}>
            {AUTOMATION_SUPPORTED
              ? `Needs iOS ${AUTOMATION_MIN_IOS} or later.`
              : `Needs iOS ${AUTOMATION_MIN_IOS} or later${IOS_VERSION ? ` — this device runs iOS ${IOS_VERSION}` : ""}. Everything else in Kopiyka works as it is.`}
          </Text>
        </View>

        <SectionHeader>Set it up once</SectionHeader>
        <Card>
          {STEPS.map((s, i) => (
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
          <Row icon="arrow.up.forward.app" title="Open Shortcuts" onPress={openShortcuts} />
        </Card>

        <SectionHeader>What to expect</SectionHeader>
        <Card>
          <Row icon="hourglass" iconColor="#FF9F0A" title="New shops wait in Pending" subtitle="Check the category once and approve." />
          <Row icon="wand.and.stars" iconColor="#30D158" title="Shops you know file themselves" subtitle="Same category and tags as last time." style={styles.divider} />
          <Row icon="creditcard" iconColor="#0A84FF" title="The right account" subtitle="Picked from the card, or the currency." style={styles.divider} />
          <Row icon="line.3.horizontal.decrease.circle" iconColor="#8E8E93" title="Only payments" subtitle="Codes, deliveries and declined payments are ignored." style={styles.divider} />
          <Row icon="slider.horizontal.3" iconColor="#5E5CE6" title="Shortcut settings" subtitle="Notifications, and anything it could not read." onPress={() => router.push("/settings/automation")} style={styles.divider} />
        </Card>

        <Text style={styles.hint}>Works with Kopiyka closed. Nothing leaves your phone.</Text>
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
