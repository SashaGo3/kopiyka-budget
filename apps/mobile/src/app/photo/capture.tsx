import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { CameraView } from "expo-camera";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolvePick } from "@/store/pick";
import { BigButton } from "@/components/ui";
import { S } from "@/constants/theme";

/**
 * Quick photo for a transaction: one shutter tap, no preview step. Pictures are taken at
 * 1080p and moderate JPEG quality so a receipt stays readable but the file stays small and
 * the capture is fast. Resolves the temporary file URI to the caller.
 *
 * A receipt is often already in the camera roll — photographed at the till, before the expense was
 * logged — so the library is offered beside the shutter, and on its own when the camera has been
 * refused. Denying the camera is not a reason to be unable to attach a picture you already have.
 */
export default function PhotoCapture() {
  // expo-camera is a heavy import other routes never need; deferred until this screen actually mounts.
  const { CameraView, useCameraPermissions } = require("expo-camera") as typeof import("expo-camera"); // eslint-disable-line @typescript-eslint/no-require-imports
  const { key } = useLocalSearchParams<{ key: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [cam, setCam] = useState<CameraView | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
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
      Alert.alert("Cannot open the library", (e as Error).message);
    }
    setBusy(false);
  };
  const shoot = async () => {
    if (!cam || busy) return;
    setBusy(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cam.takePictureAsync({ quality: 0.5, shutterSound: false, skipProcessing: true });
      if (photo?.uri) { resolvePick(key, photo.uri); router.back(); return; }
    } catch { /* fall through */ }
    setBusy(false);
  };
  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.msg}>{permission.canAskAgain ? "Camera access is needed to take a photo." : "Camera access is off. Enable it in the Settings app."}</Text>
        {permission.canAskAgain ? <BigButton label="Allow camera" onPress={() => void requestPermission()} /> : null}
        <BigButton label="Choose from library" onPress={() => void pickFromLibrary()} />
        <BigButton label="Close" onPress={() => router.back()} />
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <CameraView ref={setCam} style={StyleSheet.absoluteFill} facing="back" pictureSize="1920x1080" mute />
      <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + S.sm }]} accessibilityRole="button" accessibilityLabel="Close">
        <SymbolView name="xmark" size={18} tintColor="white" weight="semibold" />
      </Pressable>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, S.lg) + S.md }]}>
        {/* A row with a spacer on the right, so the shutter stays centred on screen rather than
            being pushed off by the library button. */}
        <Pressable onPress={() => void pickFromLibrary()} disabled={busy} hitSlop={12} style={({ pressed }) => [styles.library, styles.libraryButton, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="Choose from library">
          <SymbolView name="photo.on.rectangle" size={22} tintColor="white" />
        </Pressable>
        <Pressable onPress={() => void shoot()} disabled={busy} style={({ pressed }) => [styles.shutter, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="Take photo">
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
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: "white", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "white" },
});
