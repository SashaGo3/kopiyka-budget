import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { useQuery } from "@/store";
import { getShortcutNotify, setShortcutNotify } from "@/lib/settings";
import { C, R, S } from "@/constants/theme";

/** Setup steps, worded as what you actually tap, in the order the Shortcuts app puts them in. */
const STEPS: { title: string; subtitle: string }[] = [
  { title: "Open Shortcuts → Automation", subtitle: "The Automation tab at the bottom, then + in the top right." },
  { title: "Choose “When I receive a notification”", subtitle: "It is in the list of triggers, near the top." },
  { title: "Pick the app that tells you about payments", subtitle: "Your bank’s app, which covers every card payment and every transfer. If it sends no push notifications, pick Wallet instead — that covers Apple Pay. Adding both is fine." },
  { title: "Add a filter, then Run Immediately", subtitle: "iOS will not save the automation without a filter. Use a word every payment notification contains, such as “Amount”. Run Immediately means nothing to confirm after you pay; turn “Notify When Run” off as well and it stays out of your way entirely." },
  { title: "Add action → “Log payment from an app notification”", subtitle: "Search for it by name; it is listed under Kopiyka Budget. The action reads “Log the payment in …” with one empty field." },
  { title: "Put the Notification into that field", subtitle: "Tap the empty field, then Select Variable → Notification. That one variable carries the whole thing — the amount, the shop or sender, the card, the time — and Kopiyka reads what it needs out of it." },
  { title: "Optional: remember where you paid", subtitle: "Add “Get Current Location” above the Kopiyka action, then open Show More on the Kopiyka action and put its result into the Location field. Shortcuts will ask for location permission once; Kopiyka itself never reads your location in the background." },
];

/**
 * Card payments are not an API: iOS never hands Wallet transactions to apps, and iOS 26 dropped the
 * Shortcuts "Transaction" trigger that used to stand in for one. What is left is the notification
 * automation — the bank already tells you about the payment, and Shortcuts can pass the whole
 * notification on as one variable. The reading itself is native/KPPaymentText.swift and the filing
 * native/KopiykaIntents.swift; this screen only explains the setup.
 */
export default function ShortcutScreen() {
  const notify = useQuery(() => getShortcutNotify());
  const openShortcuts = () => {
    Linking.openURL("shortcuts://").catch(() => Alert.alert("Shortcuts not available", "Install the Shortcuts app from the App Store, then come back."));
  };

  return (
    <>
      <Stack.Screen options={{ title: "Automate with Shortcut" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={styles.intro}>
          Your bank already tells you about the payment. This sets up an automation that hands the whole notification to Kopiyka, which reads the amount, the shop or the sender, the card and the time out of its text. Six steps, once — and a seventh if you want the entry to remember where you paid.
        </Text>

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

        <SectionHeader>While it runs</SectionHeader>
        <Card>
          <ToggleRow icon="bell.badge" iconColor="#0A84FF" title="Tell me when it logs something"
            subtitle="A banner naming the amount and the shop, and whether the entry still wants a look. Tap it to open the entry. Needs notifications to be allowed."
            value={notify} onChange={setShortcutNotify} />
        </Card>

        <SectionHeader>What to expect</SectionHeader>
        <Card>
          <Row icon="bell.badge" iconColor="#8E8E93" title="One banner per payment, and no more" subtitle="It says what it logged, so you can see the charge landed — turn that off just above and it goes silent. Either way it speaks up when a notification names money it could not read." />
          <Row icon="hourglass" iconColor="#FF9F0A" title="Everything new waits in Pending" subtitle="Approve from the Pending row on Transactions. A category may be guessed from the shop's name — or, with the optional step above, from the one you usually pick where you are — to save you a tap. The queue marks it “guess” and it never approves itself." style={styles.divider} />
          <Row icon="wand.and.stars" iconColor="#30D158" title="A payment you have filed before fills itself in" subtitle="Same shop or sender, filed by hand once: its category, tags and place are copied on and it skips Pending." style={styles.divider} />
          <Row icon="arrow.triangle.branch" iconColor="#FF9F0A" title="A shop you file two ways still asks" subtitle="Fuel one week, a hot dog the next: the entry waits in Pending, and its sheet offers every pairing of category and tags you have used there — one tap each." style={styles.divider} />
          <Row icon="creditcard" iconColor="#0A84FF" title="The account is worked out" subtitle="From the card the notification names, else from the currency it is in — a charge in euro goes to a euro account rather than being converted." style={styles.divider} />
          <Row icon="lock" iconColor="#FF9F0A" title="Money only blocked still counts" subtitle="A card authorisation is a real purchase the bank has not taken yet, so it is logged — always in Pending, because it can settle days later at another amount. A hold being released is not a second purchase and is ignored." style={styles.divider} />
          <Row icon="line.3.horizontal.decrease.circle" iconColor="#8E8E93" title="No amount, no entry" subtitle="One-time codes, deliveries, balance lines, rate adverts, sign-in alerts and declined payments are all dropped." style={styles.divider} />
          <Row icon="doc.on.doc" iconColor="#5E5CE6" title="Logged once" subtitle="The same amount again within a minute is the same tap — Wallet and your bank both report it." style={styles.divider} />
        </Card>

        <Text style={styles.hint}>Runs with Kopiyka closed. The text is read on the device; nothing leaves the phone.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  intro: { color: C.secondary, fontSize: 15, lineHeight: 21, paddingHorizontal: S.xl, marginTop: S.md },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.lg },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  step: { flexDirection: "row", alignItems: "flex-start", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  num: { width: 24, height: 24, borderRadius: R.sm, backgroundColor: C.tint, alignItems: "center", justifyContent: "center" },
  numText: { color: C.onTint, fontSize: 13, fontWeight: "600" },
  stepTitle: { color: C.label, fontSize: 16 },
  stepSub: { color: C.secondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
});
