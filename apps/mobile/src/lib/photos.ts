/**
 * One photo per transaction, stored as a small JPEG in the app's Documents/photos directory and
 * referenced by file name in `transactions.photo`. Device-local for now: the name syncs with the
 * row, the file does not (a Mac blob endpoint is the follow-up).
 */
import { Directory, File, Paths } from "expo-file-system";

const dir = () => new Directory(Paths.document, "photos");

export function photoUri(name: string): string { return new File(dir(), name).uri; }

/** Copy a freshly captured picture into the photos directory under a new unique name. */
export function keepPhoto(tempUri: string): string {
  const d = dir();
  if (!d.exists) d.create();
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  new File(tempUri).copy(new File(d, name));
  return name;
}

/** The folder the photos live in, for the bundle writer and anything else that needs the directory itself. */
export function photosDirectory(): Directory { return dir(); }

/** Every photo file on this device, by name. */
export function localPhotoNames(): string[] {
  const d = dir();
  if (!d.exists) return [];
  try { return d.list().map((f) => f.name).filter((n) => n.endsWith(".jpg")); } catch { return []; }
}

/**
 * The plain filesystem path of a photo, without the `file://` scheme: `photoUri` is what React
 * Native's image loader wants, this is what the native backup module copies to and from.
 */
export function photoPath(name: string): string {
  return decodeURIComponent(new File(dir(), name).uri.replace(/^file:\/\//, ""));
}

export function deletePhoto(name: string | null | undefined): void {
  if (!name) return;
  try { const f = new File(dir(), name); if (f.exists) f.delete(); } catch { /* already gone */ }
}
