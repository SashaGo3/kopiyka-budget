/**
 * A bundle: one zip holding a full backup **and** the receipt photos it mentions.
 *
 * The backup already names each photo (`transactions.photo`), so the file name is the key and the
 * zip needs no index of its own — `photos/<that name>` is where the image lives, and importing is a
 * lookup by the name the row already carries.
 *
 * Only the packing and unpacking live here, with no file system in sight, so the format can be
 * tested. Reading and writing the actual files is the app's job (apps/mobile/src/lib/bundle.ts).
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

export const BUNDLE_BACKUP = "backup.json";
export const BUNDLE_PHOTOS = "photos/";

/**
 * `photos` is keyed by file name. JPEGs are stored rather than deflated: they are already
 * compressed, so a second pass costs seconds of phone CPU and saves almost nothing.
 */
export function packBundle(backupJson: string, photos: Record<string, Uint8Array>): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [BUNDLE_BACKUP]: [strToU8(backupJson), { level: 6 }],
  };
  for (const [name, data] of Object.entries(photos)) files[BUNDLE_PHOTOS + name] = [data, { level: 0 }];
  return zipSync(files);
}

export interface UnpackedBundle { json: string; photos: Record<string, Uint8Array> }

/** Throws when the zip holds no backup; entries that are not plain photo names are ignored. */
export function unpackBundle(bytes: Uint8Array): UnpackedBundle {
  const entries = unzipSync(bytes);
  const backup = entries[BUNDLE_BACKUP];
  if (!backup) throw new Error(`This zip has no ${BUNDLE_BACKUP} in it`);
  const photos: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(BUNDLE_PHOTOS) || path.endsWith("/")) continue;
    const name = path.slice(BUNDLE_PHOTOS.length);
    // A name with a separator still in it was never written by this app. Refusing it is what stops a
    // crafted zip from walking out of the photos folder and writing wherever it likes.
    if (name && !name.includes("/") && !name.includes("\\") && !name.startsWith(".")) photos[name] = data;
  }
  return { json: strFromU8(backup), photos };
}
