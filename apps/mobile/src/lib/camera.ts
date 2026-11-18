/**
 * The one way the app takes a photo: the receipt camera (native/KPDocScan.swift). Point, tap, and
 * the picture comes back cropped to the receipt when there is one on it, whole when there is not —
 * so it serves any photo, not only receipts. Its library button takes a picture already in Photos
 * through the same cropping.
 *
 * Without that camera (the simulator, or camera access refused) the photo library opens instead:
 * a picture you already have is never out of reach because the camera is.
 *
 * Resolves a temporary file URI, or null when nothing was taken.
 */
import { Alert } from "react-native";
import { KPBridge } from "@/lib/bridge";
import { t } from "@/i18n";

let busy = false;

export async function takePhoto(): Promise<string | null> {
  if (busy) return null;
  busy = true;
  try {
    if (KPBridge.canScanDocument()) {
      try { return await KPBridge.scanDocument(); } catch { /* camera refused: the library below */ }
    }
    return await fromLibrary();
  } finally { busy = false; }
}

async function fromLibrary(): Promise<string | null> {
  try {
    // A heavy import, needed only where the camera is not.
    const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker"); // eslint-disable-line @typescript-eslint/no-require-imports
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    return r.canceled ? null : r.assets?.[0]?.uri ?? null;
  } catch (e) {
    Alert.alert(t("photo.libraryError"), (e as Error).message);
    return null;
  }
}
