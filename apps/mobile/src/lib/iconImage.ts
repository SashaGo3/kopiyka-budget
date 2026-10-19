/**
 * Pictures a recurring payment can wear (`img:<data URI>`, core's logos.ts): kept in the row itself,
 * so they are shrunk to a tile's worth of pixels first — 120 px, a few KB.
 */
import * as ImagePicker from "expo-image-picker";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";

/** Edge of a stored icon, in pixels: three times the largest tile the app draws one in. */
export const ICON_PX = 120;

/**
 * An image (a file or a data URI) as a small data URI. `alpha` keeps transparency as PNG — a
 * website's icon is often a shape on nothing; a photo or a screenshot goes to JPEG.
 */
export async function shrinkIcon(uri: string, alpha: boolean): Promise<string> {
  const r = await manipulateAsync(uri, [{ resize: { width: ICON_PX, height: ICON_PX } }], { format: alpha ? SaveFormat.PNG : SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!r.base64) throw new Error("no image data");
  return `data:image/${alpha ? "png" : "jpeg"};base64,${r.base64}`;
}

/** A square crop of a picture from Photos — a saved logo, a screenshot of one. Null when cancelled. */
export async function iconFromPhotos(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
  const uri = res.canceled ? null : res.assets[0]?.uri;
  return uri ? shrinkIcon(uri, false) : null;
}
