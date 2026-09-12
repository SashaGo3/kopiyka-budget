import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { HOME_RADIUS_M } from "@kopiyka/core";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { setOnboarded } from "@/lib/onboarding";
import { ensureNotificationPermission, notificationStatus } from "@/lib/notifications";
import { ensureLocationPermission, locationStatus, placeName, quickLocation } from "@/lib/location";
import { getHomeLocation, getLocationEnabled, setHomeLocation, setLocationEnabled } from "@/lib/settings";

type Status = "granted" | "denied" | "undetermined";

/**
 * Step 4: the two permissions the app can use, each explained and switched on here (the iOS
 * prompt appears when a switch is turned on). Nothing is requested silently; both stay off
 * when skipped and can be changed later in Settings.
 */
export default function OnboardingPermissions() {
  const [notif, setNotif] = useState<Status>("undetermined");
  const [loc, setLoc] = useState<Status>("undetermined");
  const [locOn, setLocOn] = useState(getLocationEnabled());
  const [home, setHome] = useState(getHomeLocation());
  const [settingHome, setSettingHome] = useState(false);
  const refresh = useCallback(() => { void notificationStatus().then(setNotif); void locationStatus().then(setLoc); }, []);
  useEffect(refresh, [refresh]);
  useFocusEffect(refresh); // back from the Settings app
  const finish = () => { setOnboarded(); router.replace("/transactions"); };

  const setHomeHere = async () => {
    setSettingHome(true);
    try {
      const c = await quickLocation();
      if (!c) { Alert.alert("No location yet", "Could not read the phone's location. Try again in a moment."); return; }
      const next = { ...c, place: await placeName(c) };
      setHomeLocation(next);
      setHome(next);
    } finally { setSettingHome(false); }
  };

  const toggleNotif = async (on: boolean) => {
    if (!on) { void Linking.openSettings(); return; }           // iOS only lets the Settings app revoke it
    if (notif === "denied") { void Linking.openSettings(); return; }
    setNotif((await ensureNotificationPermission()) ? "granted" : await notificationStatus());
  };
  const toggleLoc = async (on: boolean) => {
    if (!on) { setLocationEnabled(false); setLocOn(false); return; }
    if (loc === "denied") { void Linking.openSettings(); return; }
    const ok = await ensureLocationPermission();
    setLoc(ok ? "granted" : await locationStatus());
    if (ok) { setLocationEnabled(true); setLocOn(true); }
  };

  return (
    <OnboardingFrame step={4} title="Two things to allow" subtitle="Both are optional. The app works fully without them."
      primary={{ label: "Continue", onPress: finish }}
      secondary={{ label: "Skip for now", onPress: finish }}>
      <View style={styles.list}>
        <PermissionRow icon="bell.badge" color="#FF3B30" title="Notifications" value={notif === "granted"} onChange={(v) => void toggleNotif(v)} delay={150}
          text="A reminder before a recurring payment is due and a note when one is posted. Local only, nothing leaves the phone."
          status={notif === "denied" ? "Turned off in the Settings app · tap to open" : notif === "granted" ? "Allowed" : "Off"} />
        <PermissionRow icon="location" color="#34C759" title="Location" value={locOn && loc === "granted"} onChange={(v) => void toggleLoc(v)} delay={230}
          text="Remembers where you spend so the category you used at the same place is suggested next time. Only while the app is open."
          status={loc === "denied" ? "Turned off in the Settings app · tap to open" : locOn && loc === "granted" ? "On" : "Off"}>
          {locOn && loc === "granted" ? (
            <View style={styles.homeBlock}>
              <Text style={styles.homeText}>
                {home ? `Home is ${home.place ?? `${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}`}. Nothing is suggested within ${HOME_RADIUS_M} m of it.`
                  : `Anything gets bought at home, so nothing is suggested within ${HOME_RADIUS_M} m of it.`}
              </Text>
              <Pressable onPress={() => void setHomeHere()} disabled={settingHome} accessibilityRole="button"
                accessibilityLabel={home ? "Update home location" : "Use my current location as home"}
                style={({ pressed }) => [(pressed || settingHome) && { opacity: 0.5 }]}>
                <Text style={styles.homeAction}>{settingHome ? "Reading location…" : home ? "Use current location instead" : "Use my current location"}</Text>
              </Pressable>
            </View>
          ) : null}
        </PermissionRow>
      </View>
    </OnboardingFrame>
  );
}

function PermissionRow({ icon, color, title, text, status, value, onChange, delay, children }: { icon: SFSymbol; color: string; title: string; text: string; status: string; value: boolean; onChange: (v: boolean) => void; delay: number; children?: ReactNode }) {
  return (
    <FadeIn delay={delay} style={styles.row}>
      <View style={styles.rowHead}>
        <View style={[styles.badge, { backgroundColor: color }]}><SymbolView name={icon} size={20} tintColor="white" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.status}>{status}</Text>
        </View>
        <Switch value={value} onValueChange={onChange} accessibilityLabel={`Allow ${title.toLowerCase()}`} />
      </View>
      <Text style={styles.text}>{text}</Text>
      {children}
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  list: { gap: S.md, paddingTop: S.sm },
  row: { backgroundColor: C.card, borderRadius: 16, padding: S.md, gap: S.sm },
  rowHead: { flexDirection: "row", alignItems: "center", gap: S.md },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700", color: C.label },
  status: { fontSize: 13, color: C.secondary, marginTop: 1 },
  text: { fontSize: 14, lineHeight: 20, color: C.secondary },
  homeBlock: { paddingTop: S.sm, gap: S.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  homeText: { fontSize: 13, lineHeight: 18, color: C.secondary },
  homeAction: { fontSize: 14, fontWeight: "600", color: C.tint },
});
