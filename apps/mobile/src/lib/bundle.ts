/**
 * A bundle: one `.zip` holding the full backup **and** the receipt photos it mentions.
 *
 * The JSON already names each photo (`transactions.photo`), so the file name is the key and the zip
 * needs no index of its own — `photos/<that name>` is where the image lives, and an import is a
 * lookup by the name the row already carries. That is what makes a bundle portable: hand it to
 * another phone, or keep it as the one file that is genuinely everything.
 *
 * The daily iCloud backups stay as they are (JSON beside a photo mirror, see lib/backup.ts). A
 * bundle is for moving data somewhere else on purpose, so it is built on demand and never on a timer.
 */
import { File, Paths } from "expo-file-system";
import { exportBackupJson, importBackup, packBundle, unpackBundle, type ImportMode } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { localPhotoNames, photosDirectory } from "@/lib/photos";

/** Photos any row points at. A file nothing references is left out — a bundle is the data, not the litter. */
function referencedPhotos(): string[] {
  const wanted = new Set(db.all<{ photo: string }>(`SELECT DISTINCT photo FROM transactions WHERE photo IS NOT NULL AND photo<>''`).map((r) => r.photo));
  return localPhotoNames().filter((n) => wanted.has(n));
}

export interface BundleBuild { bytes: Uint8Array; photos: number }

export function buildBundle(): BundleBuild {
  const images: Record<string, Uint8Array> = {};
  for (const name of referencedPhotos()) {
    // A row pointing at a file that is gone must not sink the whole export.
    try { images[name] = new File(photosDirectory(), name).bytesSync(); } catch { /* skip it */ }
  }
  return { bytes: packBundle(exportBackupJson(db), images), photos: Object.keys(images).length };
}

/** Write the bundle's photos into the app's own folder, skipping any that are already there. */
export function writePhotos(photos: Record<string, Uint8Array>): number {
  const dir = photosDirectory();
  if (!dir.exists) dir.create();
  let n = 0;
  for (const [name, data] of Object.entries(photos)) {
    const f = new File(dir, name);
    if (f.exists) continue;
    try { f.write(data); n++; } catch { /* out of space, or a name the filesystem refuses */ }
  }
  return n;
}

export interface BundleImport { summary: string; photos: number }

/** Import a bundle: the backup first (merged or replacing), then the images its rows point at. */
export function importBundle(bytes: Uint8Array, mode: ImportMode = "merge"): BundleImport {
  const { json, photos } = unpackBundle(bytes);
  const r = mutate((d) => importBackup(d, json, { mode }));
  const written = writePhotos(photos);
  const rows = Object.values(r.imported).reduce((a, b) => a + b, 0);
  const tail = mode === "replace" ? `${r.removed} removed` : `${r.skipped} already up to date`;
  return {
    summary: `${r.imported.transactions} transactions, ${r.imported.accounts} accounts, ${r.imported.categories} categories, ${r.imported.tags} tags · ${rows} rows in total, ${tail}. ${written} photo${written === 1 ? "" : "s"} added.`,
    photos: written,
  };
}

/** The bundle written to a cache file, ready to be shared. */
export function bundleFile(day: string): { file: File; photos: number; size: number } {
  const { bytes, photos } = buildBundle();
  const file = new File(Paths.cache, `Kopiyka-${day}.zip`);
  if (file.exists) file.delete();
  file.write(bytes);
  return { file, photos, size: bytes.length };
}
