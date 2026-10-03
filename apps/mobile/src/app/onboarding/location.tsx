import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { HOME_RADIUS_M } from "@kopiyka/core";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { ensureLocationPermission, placeName, preciseLocation } from "@/lib/location";
import { getHomeLocation, setHomeLocation, setLocationEnabled } from "@/lib/settings";
import { t } from "@/i18n";

/** Built per render, never at import: the words are in whatever language the app is in now. */
const points = (): { icon: SFSymbol; title: string; text: string }[] => [
  { icon: "wand.and.stars", title: t("onboarding.location.pickedTitle"), text: t("onboarding.location.pickedText") },
  { icon: "iphone", title: t("onboarding.location.openTitle"), text: t("onboarding.location.openText") },
  { icon: "lock", title: t("onboarding.location.localTitle"), text: t("onboarding.location.localText") },
];

/**
 * Step 2: location, explained here and asked of iOS from the same screen.
 *
 * The explanation is allowed; a way past it is not. A screen that describes a permission and then
 * lets the user leave without the system prompt ever appearing is what App Review reads as putting
 * the request off, and it is what 1.0 (28) was rejected for under guideline 5.1.1(iv). So there is
 * exactly one way forward and it asks iOS every time: "Don't Allow" is an answer the user gives in
 * Apple's dialog, not in ours, which is why this screen has no Skip and no second button.
 *
 * Granting it turns the app's own "Remember location" preference on and turns the screen into the
 * one other thing the feature needs — where home is, since anything gets bought there and a
 * suggestion at home would be noise. Refusing it moves straight on; nothing here is a gate, and
 * both the permission and home can be set later in Settings.
 *
 * It comes before the account step on purpose: with location granted, that step can name the
 * currency of the country the phone is actually in rather than the one its region setting says.
 */
export default function OnboardingLocation() {
  const [granted, setGranted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [home, setHome] = useState(getHomeLocation());
  const [settingHome, setSettingHome] = useState(false);
  const next = () => router.push("/onboarding/account");

  const ask = async () => {
    if (asking) return;
    setAsking(true);
    try {
      if (!(await ensureLocationPermission())) { next(); return; }
      setLocationEnabled(true);   // the app's own switch follows the answer iOS was given
      setGranted(true);
    } finally { setAsking(false); }
  };

  const setHomeHere = async () => {
    setSettingHome(true);
    try {
      const c = await preciseLocation();
      if (!c) { Alert.alert(t("onboarding.location.noFixTitle"), t("onboarding.location.noFixBody")); return; }
      const spot = { ...c, place: await placeName(c) };
      setHomeLocation(spot);
      setHome(spot);
    } finally { setSettingHome(false); }
  };

  const where = home ? home.place ?? `${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}` : null;
  return (
    <OnboardingFrame step={2}
      title={granted ? t("onboarding.location.homeTitle") : t("onboarding.location.title")}
      subtitle={granted ? t("onboarding.location.homeSubtitle", { radius: HOME_RADIUS_M }) : t("onboarding.location.subtitle")}
      primary={{ label: !granted && asking ? t("onboarding.location.asking") : t("onboarding.continue"), onPress: granted ? next : () => void ask(), disabled: asking }}>
      {granted ? (
        <View style={styles.list}>
          <FadeIn delay={80} style={styles.point}>
            <View style={styles.badge}><SymbolView name="house" size={22} tintColor={C.tint} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointTitle}>{where ?? t("onboarding.location.notSet")}</Text>
              <Text style={styles.pointText}>{where ? t("onboarding.location.homeHere", { radius: HOME_RADIUS_M }) : t("onboarding.location.homeNone")}</Text>
            </View>
          </FadeIn>
          <Pressable onPress={() => void setHomeHere()} disabled={settingHome} accessibilityRole="button"
            accessibilityLabel={home ? t("onboarding.location.useInsteadA11y") : t("onboarding.location.useA11y")}
            style={({ pressed }) => [styles.action, (pressed || settingHome) && { opacity: 0.5 }]}>
            <SymbolView name="location.fill" size={15} tintColor={C.tint} />
            <Text style={styles.actionText}>{settingHome ? t("onboarding.location.reading") : home ? t("onboarding.location.useInstead") : t("onboarding.location.use")}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {points().map((p, i) => (
            <FadeIn key={p.title} delay={200 + i * 90} style={styles.point}>
              <View style={styles.badge}><SymbolView name={p.icon} size={22} tintColor={C.tint} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pointTitle}>{p.title}</Text>
                <Text style={styles.pointText}>{p.text}</Text>
              </View>
            </FadeIn>
          ))}
        </View>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  list: { gap: S.md, paddingTop: S.md },
  point: { flexDirection: "row", gap: S.md, alignItems: "center", backgroundColor: C.card, borderRadius: 16, padding: S.md },
  badge: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  pointTitle: { fontSize: 16, fontWeight: "700", color: C.label },
  pointText: { fontSize: 14, color: C.secondary, marginTop: 2, lineHeight: 19 },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 },
  actionText: { fontSize: 15, fontWeight: "600", color: C.tint },
});
