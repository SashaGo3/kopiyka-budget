import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { listRows } from "@kopiyka/core";
import { db } from "@/db";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { pickAndImport } from "@/lib/importers";
import { setOnboarded } from "@/lib/onboarding";
import { markBooted } from "@/lib/boot";
import { RECEIPT_SCANNER_ENABLED } from "@/constants/features";

const POINTS: { icon: SFSymbol; title: string; text: string }[] = [
  { icon: "iphone", title: "Yours, on your phone", text: "Every number stays on the device. No sign-up, no servers." },
  { icon: "applewatch", title: "Log in two taps", text: RECEIPT_SCANNER_ENABLED ? "From the watch, Siri, a Shortcut or a photo of the receipt." : "From the watch, Siri or a Shortcut." },
  { icon: "icloud", title: "Backed up to iCloud", text: "A copy is saved to your iCloud Drive every day, up to seven times a day." },
];

/** Welcome: what the app is, then either set up from scratch or restore a backup. */
export default function Welcome() {
  const [busy, setBusy] = useState(false);
  useEffect(() => { markBooted(); }, []);
  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const summary = await pickAndImport({ confirm: false });
      if (!summary) return;
      setOnboarded();
      const hasAccounts = listRows(db, "accounts", "deleted=0").length > 0;
      Alert.alert("Backup restored", summary, [{ text: "Continue", onPress: () => router.replace(hasAccounts ? "/transactions" : "/onboarding/account") }]);
    } catch (e) { Alert.alert("Could not restore", (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <OnboardingFrame step={1} title="Kopiyka" subtitle="Local-first budgeting. Set up in under a minute."
      primary={{ label: "Get started", onPress: () => router.push("/onboarding/location") }}
      secondary={{ label: busy ? "Restoring…" : "Restore from a backup", onPress: () => void restore() }}>
      <View style={styles.hero}>
        <Image source={require("../../../assets/images/icon.png")} style={styles.icon} accessibilityIgnoresInvertColors />
      </View>
      <View style={styles.points}>
        {POINTS.map((p, i) => (
          <FadeIn key={p.title} delay={200 + i * 90} style={styles.point}>
            <View style={styles.badge}><SymbolView name={p.icon} size={22} tintColor={C.tint} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointTitle}>{p.title}</Text>
              <Text style={styles.pointText}>{p.text}</Text>
            </View>
          </FadeIn>
        ))}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: S.xl },
  icon: { width: 112, height: 112, borderRadius: 26 },
  points: { gap: S.md },
  point: { flexDirection: "row", gap: S.md, alignItems: "center", backgroundColor: C.card, borderRadius: 16, padding: S.md },
  badge: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  pointTitle: { fontSize: 16, fontWeight: "700", color: C.label },
  pointText: { fontSize: 14, color: C.secondary, marginTop: 2 },
});
