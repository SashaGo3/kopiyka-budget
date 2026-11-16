import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { CameraView } from "expo-camera";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolvePick } from "@/store/pick";
import { KPBridge } from "@/lib/bridge";
import { BigButton, Tap } from "@/components/ui";
import { S } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Quick photo for a transaction: one shutter tap, no preview step. Resolves the temporary file URI
 * to the caller, which reads its text at once (lib/photoText.ts).
 *
 * Two modes, like the Camera app's: Receipt and Photo. Receipt is the system document camera
 * (native/KPDocScan.swift), which finds the paper, takes the picture on its own once it is steady and
 * hands back a flat, straightened page — far easier to read than a snapshot. The mode last used is
 * where the next capture starts, so someone who photographs receipts goes straight to the scanner.
 * Photo pictures are taken at the camera's own resolution: at 1080p a long receipt was a few hundred
 * pixels wide and its print came back misread.
 *
 * A receipt is often already in the camera roll — photographed at the till, before the expense was
 * logged — so the library is offered beside the shutter, and on its own when the camera has been
 * refused. Denying the camera is not a reason to be unable to attach a picture you already have.
 */
// The mode the last capture used; Receipt where the device has a document camera.
const last: { mode: "receipt" | "photo" | null } = { mode: null };
function rememberMode(m: "receipt" | "photo") { last.mode = m; }

export default function PhotoCapture() {
  // expo-camera is a heavy import other routes never need; deferred until this screen actually mounts.
  const { CameraView, useCameraPermissions } = require("expo-camera") as typeof import("expo-camera"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { key } = useLocalSearchParams<{ key: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [cam, setCam] = useState<CameraView | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const canScan = KPBridge.canScanDocument();
  const [mode, setModeState] = useState<"receipt" | "photo">(canScan ? last.mode ?? "receipt" : "photo");
  const scanning = useRef(false);
  const scan = async () => {
    if (scanning.current) return;
    scanning.current = true;
    try {
      const uri = await KPBridge.scanDocument();
      if (uri) { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); resolvePick(key, uri); router.back(); return; }
      // Cancelled: stay here, on the plain camera, so Close or a snapshot is one tap away.
      setModeState("photo");
    } catch (e) {
      setModeState("photo");
      Alert.alert(t("photo.scanFailed"), (e as Error).message);
    } finally { scanning.current = false; }
  };
  const setMode = (m: "receipt" | "photo") => { rememberMode(m); setModeState(m); if (m === "receipt") void scan(); };
  // Opening in Receipt mode opens the scanner straight away: one tap from the entry to the receipt.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- opens a native screen; its answer arrives later
  useEffect(() => { if (mode === "receipt") void scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pickFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // As heavy an import as the camera, and needed even less often.
      const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker"); // eslint-disable-line @typescript-eslint/no-require-imports
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5 });
      const uri = r.canceled ? null : r.assets?.[0]?.uri;
      if (uri) { resolvePick(key, uri); router.back(); return; }
    } catch (e) {
      Alert.alert(t("photo.libraryError"), (e as Error).message);
    }
    setBusy(false);
  };
  const shoot = async () => {
    if (!cam || busy) return;
    setBusy(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cam.takePictureAsync({ quality: 0.6, shutterSound: false });
      if (photo?.uri) { resolvePick(key, photo.uri); router.back(); return; }
    } catch { /* fall through */ }
    setBusy(false);
  };
  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.msg}>{permission.canAskAgain ? t("photo.cameraNeeded") : t("photo.cameraOff")}</Text>
        {permission.canAskAgain ? <BigButton label={t("photo.allowCamera")} onPress={() => void requestPermission()} /> : null}
        <BigButton label={t("photo.fromLibrary")} onPress={() => void pickFromLibrary()} />
        <BigButton label={t("common.close")} onPress={() => router.back()} />
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <CameraView ref={setCam} style={StyleSheet.absoluteFill} facing="back" mute />
      <Tap onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + S.sm }]} accessibilityRole="button" accessibilityLabel={t("common.close")}>
        <SymbolView name="xmark" size={18} tintColor="white" weight="semibold" />
      </Tap>
      {canScan ? (
        <View style={[styles.modes, { bottom: Math.max(insets.bottom, S.lg) + S.md + 76 + S.lg }]} accessibilityRole="tablist">
          {(["receipt", "photo"] as const).map((m) => (
            <Tap key={m} onPress={() => setMode(m)} style={[styles.mode, mode === m && styles.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
              <SymbolView name={m === "receipt" ? "doc.text.viewfinder" : "camera"} size={14} tintColor={mode === m ? "black" : "white"} />
              <Text style={[styles.modeText, mode === m && { color: "black" }]}>{m === "receipt" ? t("photo.mode.receipt") : t("photo.mode.photo")}</Text>
            </Tap>
          ))}
        </View>
      ) : null}
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, S.lg) + S.md }]}>
        {/* A row with a spacer on the right, so the shutter stays centred on screen rather than
            being pushed off by the library button. */}
        <Pressable onPress={() => void pickFromLibrary()} disabled={busy} hitSlop={12} style={({ pressed }) => [styles.library, styles.libraryButton, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t("photo.fromLibrary")}>
          <SymbolView name="photo.on.rectangle" size={22} tintColor="white" />
        </Pressable>
        <Pressable onPress={() => void shoot()} disabled={busy} style={({ pressed }) => [styles.shutter, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t("photo.take")}>
          {busy ? <ActivityIndicator color="black" /> : <View style={styles.shutterInner} />}
        </Pressable>
        <View style={styles.library} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "black" },
  center: { alignItems: "stretch", justifyContent: "center", gap: S.md, padding: S.xl },
  msg: { color: "white", fontSize: 17, textAlign: "center", marginBottom: S.md },
  close: { position: "absolute", right: S.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.xxl },
  library: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  libraryButton: { backgroundColor: "rgba(0,0,0,0.45)" },
  modes: { position: "absolute", alignSelf: "center", flexDirection: "row", gap: 4, padding: 4, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)" },
  mode: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 32, borderRadius: 16 },
  modeOn: { backgroundColor: "white" },
  modeText: { color: "white", fontSize: 14, fontWeight: "600" },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: "white", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "white" },
});
