import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { CameraView } from "expo-camera";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KPBridge, type ReceiptParse } from "@/lib/bridge";
import { resolvePick } from "@/store/pick";
import { BigButton } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Hands-free receipt capture: once the camera is ready the screen keeps taking a photo every
 * couple of seconds and hands it to the native reader (Vision + on-device model); the first
 * photo that yields a total wins. The shutter still works for an immediate shot, and ✕ closes.
 * Resolves a ReceiptParse to the caller.
 */
export default function ReceiptScan() {
  // expo-camera is a heavy import other routes never need; deferred until this screen actually mounts.
  const { CameraView, useCameraPermissions } = require("expo-camera") as typeof import("expo-camera"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { key } = useLocalSearchParams<{ key: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(() => t("photo.receipt.hold"));
  const [attempts, setAttempts] = useState(0);
  const cam = useRef<CameraView>(null);
  const busy = useRef(false);
  const done = useRef(false);
  const insets = useSafeAreaInsets();

  const attempt = async (manual: boolean) => {
    if (busy.current || done.current || !cam.current) return;
    busy.current = true;
    setStatus(manual ? t("photo.receipt.reading") : t("photo.receipt.looking"));
    try {
      const photo = await cam.current.takePictureAsync({ quality: 0.7, shutterSound: false });
      if (!photo?.uri) throw new Error(t("photo.receipt.noPhoto"));
      const parse: ReceiptParse = await KPBridge.scanReceipt(photo.uri);
      if (!(parse.total > 0)) throw new Error(t("photo.receipt.noTotal"));
      done.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resolvePick(key, parse);
      router.back();
    } catch (e) {
      setAttempts((n) => n + 1);
      setStatus(manual ? t("photo.receipt.failed", { error: (e as Error).message }) : t("photo.receipt.looking"));
    } finally { busy.current = false; }
  };
  // Automatic attempts start a moment after the camera is up and repeat until one succeeds or the screen closes.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void attempt(false), 1200);
    const i = setInterval(() => void attempt(false), 2500);
    return () => { clearTimeout(timer); clearInterval(i); done.current = true; };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t("photo.receipt.cameraNeeded")}</Text>
        <BigButton label={t("photo.allowCamera")} onPress={() => void requestPermission()} />
        <BigButton label={t("common.close")} onPress={() => router.back()} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView ref={cam} style={{ flex: 1 }} facing="back" onCameraReady={() => setReady(true)} />
      <Pressable onPress={() => { done.current = true; router.back(); }} hitSlop={12} style={[styles.close, { top: insets.top + S.sm }]} accessibilityRole="button" accessibilityLabel={t("common.close")}>
        <SymbolView name="xmark" size={18} tintColor="white" weight="bold" />
      </Pressable>
      <View style={styles.frame} pointerEvents="none" />
      <View style={[styles.overlay, { bottom: insets.bottom + S.xl }]}>
        <View style={styles.hintRow}>
          {ready ? <ActivityIndicator color="white" /> : null}
          <Text style={styles.hint}>{attempts > 2 ? `${status} · ${t("photo.receipt.lightTip")}` : status}</Text>
        </View>
        <Pressable onPress={() => void attempt(true)} style={styles.shutter} accessibilityRole="button" accessibilityLabel={t("photo.receipt.takeNow")}>
          <SymbolView name="camera.fill" size={26} tintColor="black" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "flex-end", padding: S.xl, gap: S.md, backgroundColor: C.bgGrouped },
  text: { color: C.label, fontSize: 17, textAlign: "center" },
  close: { position: "absolute", left: S.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  frame: { position: "absolute", left: "8%", right: "8%", top: "14%", bottom: "24%", borderRadius: 18, borderWidth: 2, borderColor: "rgba(255,255,255,0.55)" },
  overlay: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: S.lg },
  hintRow: { flexDirection: "row", alignItems: "center", gap: S.sm, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  hint: { color: "white", fontSize: 15 },
  shutter: { width: 72, height: 72, borderRadius: 36, backgroundColor: "white", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "rgba(255,255,255,0.4)" },
});
