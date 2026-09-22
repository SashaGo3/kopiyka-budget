import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { eraseAll, listRows } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { pickAndImport } from "@/lib/importers";
import { setOnboarded } from "@/lib/onboarding";
import { markBooted } from "@/lib/boot";
import { findRestorable, markContainerSeen, restoreBackup, type BackupEntry } from "@/lib/backup";
import { humanDayTime } from "@/lib/dates";
import { RECEIPT_SCANNER_ENABLED } from "@/constants/features";

const POINTS: { icon: SFSymbol; title: string; text: string }[] = [
  { icon: "iphone", title: "Yours, on your phone", text: "Every number stays on the device. No sign-up, no servers." },
  { icon: "applewatch", title: "Log in two taps", text: RECEIPT_SCANNER_ENABLED ? "From the watch, Siri, a Shortcut or a photo of the receipt." : "From the watch, Siri or a Shortcut." },
  { icon: "icloud", title: "Backed up to iCloud", text: "A copy is saved to your iCloud Drive every day, up to seven times a day." },
];

/** How often the container is looked at while this screen is up, and for how long. */
const LOOK_EVERY_MS = 4_000;
const LOOK_FOR_MS = 2 * 60_000;

/** Welcome: what the app is, then either set up from scratch or restore a backup. */
export default function Welcome() {
  const [busy, setBusy] = useState(false);
  const [cloud, setCloud] = useState<"idle" | "restoring">("idle");
  // Read by the poll below, which must not fire while a restore is already running. Set where the
  // work starts rather than during render, so the poll can never see a stale `false`.
  const working = useRef(false);
  useEffect(() => { markBooted(); }, []);
  const enter = () => {
    setOnboarded();
    router.replace(listRows(db, "accounts", "deleted=0").length > 0 ? "/transactions" : "/onboarding/account");
  };
  const restore = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const summary = await pickAndImport({ confirm: false });
      if (!summary) return;
      // Whatever was in the container has now been decided about: the phone is this file, and
      // auto-sync must not pour a second history on top of it the moment the app opens.
      await markContainerSeen();
      Alert.alert("Backup restored", summary, [{ text: "Continue", onPress: enter }]);
    } catch (e) { Alert.alert("Could not restore", (e as Error).message); }
    finally { working.current = false; setBusy(false); }
  };

  /**
   * A new device restores itself. This install has no data, so anything in the iCloud container is
   * the user's own history waiting to come back, and asking them to find it in a file picker is
   * asking them to do what the app can see for itself.
   *
   * It runs on what `sync_seen` has never accounted for (`findRestorable`), which is what keeps it
   * from undoing an erase: "Erase this phone" leaves that set behind, so the backups it has already
   * read stay read. And it is offered back — the alert's other button erases what just arrived and
   * marks the container decided, so one tap returns to an empty app that stays empty.
   */
  const autoRestore = useCallback(async (f: BackupEntry) => {
    working.current = true;
    setCloud("restoring");
    try {
      // Photos follow in the background: fetching one iCloud has not downloaded yet can take a
      // minute each, and none of them is a reason to keep the user on the welcome screen.
      const summary = await restoreBackup(f, "merge", { photos: "background" });
      await markContainerSeen();
      Alert.alert("Restored from iCloud", `Your data as of ${humanDayTime(f.day)}.\n\n${summary}`, [
        { text: "Start fresh instead", style: "destructive", onPress: () => { mutate((d) => eraseAll(d, { everywhere: false })); working.current = false; setCloud("idle"); } },
        { text: "Continue", onPress: enter },
      ]);
    } catch {
      working.current = false;
      setCloud("idle");   // still downloading, or unreadable: the poll comes round again
    }
  }, []);

  // Only while this screen is the one on top, and only for a couple of minutes: a container a
  // brand-new device has never opened can take a while to materialise, and after that the user is
  // setting the app up by hand and a backup appearing behind them would be an ambush.
  useFocusEffect(useCallback(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const until = Date.now() + LOOK_FOR_MS;
    const look = async () => {
      if (!alive) return;
      const found = working.current ? null : await findRestorable().catch(() => null);
      if (!alive) return;
      if (found) void autoRestore(found);
      else if (Date.now() < until) timer = setTimeout(() => void look(), LOOK_EVERY_MS);
    };
    void look();
    return () => { alive = false; clearTimeout(timer); };
  }, [autoRestore]));

  return (
    <OnboardingFrame step={1} title="Kopiyka" subtitle="Local-first budgeting. Set up in under a minute."
      primary={cloud === "restoring"
        ? { label: "Restoring from iCloud…", onPress: () => {}, disabled: true }
        : { label: "Get started", onPress: () => router.push("/onboarding/location") }}
      secondary={cloud === "restoring" ? undefined : { label: busy ? "Restoring…" : "Restore from a backup", onPress: () => void restore() }}>
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
