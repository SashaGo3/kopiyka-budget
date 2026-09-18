import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { HOME_RADIUS_M } from "@kopiyka/core";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { ensureLocationPermission, placeName, quickLocation } from "@/lib/location";
import { getHomeLocation, setHomeLocation, setLocationEnabled } from "@/lib/settings";

const POINTS: { icon: SFSymbol; title: string; text: string }[] = [
  { icon: "wand.and.stars", title: "The category, already picked", text: "Log something where you logged something before and that category is waiting on the keypad." },
  { icon: "iphone", title: "Only while the app is open", text: "Kopiyka never asks for background location and cannot see where you are once it is closed." },
  { icon: "lock", title: "It stays on this phone", text: "The place is saved beside the entry in the local database, like every other number here." },
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
      const c = await quickLocation();
      if (!c) { Alert.alert("No location yet", "Could not read the phone's location. Try again in a moment, or set home later in Settings."); return; }
      const next = { ...c, place: await placeName(c) };
      setHomeLocation(next);
      setHome(next);
    } finally { setSettingHome(false); }
  };

  const where = home ? home.place ?? `${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}` : null;
  return (
    <OnboardingFrame step={2}
      title={granted ? "Where is home?" : "Remember where you spend"}
      subtitle={granted
        ? `Anything gets bought at home, so nothing is suggested within ${HOME_RADIUS_M} m of it. Set it now if you are there, or later in Settings.`
        : "Kopiyka can offer the category you used at the same place last time. iOS asks next — either answer is fine, and the app works fully without it."}
      primary={{ label: granted ? "Continue" : asking ? "Asking…" : "Continue", onPress: granted ? next : () => void ask(), disabled: asking }}>
      {granted ? (
        <View style={styles.list}>
          <FadeIn delay={80} style={styles.point}>
            <View style={styles.badge}><SymbolView name="house" size={22} tintColor={C.tint} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointTitle}>{where ?? "Not set yet"}</Text>
              <Text style={styles.pointText}>{where ? `Nothing is suggested within ${HOME_RADIUS_M} m of here.` : "Nothing is left out until you set it."}</Text>
            </View>
          </FadeIn>
          <Pressable onPress={() => void setHomeHere()} disabled={settingHome} accessibilityRole="button"
            accessibilityLabel={home ? "Use current location as home instead" : "Use my current location as home"}
            style={({ pressed }) => [styles.action, (pressed || settingHome) && { opacity: 0.5 }]}>
            <SymbolView name="location.fill" size={15} tintColor={C.tint} />
            <Text style={styles.actionText}>{settingHome ? "Reading location…" : home ? "Use current location instead" : "Use my current location"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
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
