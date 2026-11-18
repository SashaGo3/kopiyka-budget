/**
 * What a transaction's photo says, read in the background and kept.
 *
 * Three steps, each published the moment it lands so the viewer fills in as it goes: the text
 * (Vision, about a second), what it means — merchant, total, items (the receipt reader, on-device
 * model where there is one) — and a category per item, for sorting a mixed receipt into a split.
 * Nothing here writes to the database: it is a cache, not data (DATA.md rule 4 — a photo file is
 * never modified under its name, so its name is a safe key). The cache lives in the app's Caches
 * folder; iOS may empty it, and the photo is simply read again.
 *
 * Reading starts as soon as anything asks — the entry sheet does when it shows a photo, so by the
 * time the photo is opened the text is usually there already. One reading per photo at a time.
 */
import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import { KPBridge, type ReceiptParse } from "@/lib/bridge";

export type PhotoReading = {
  /** `text`: the lines are in, the items still coming; `items`: items in, their categories coming. */
  status: "reading" | "text" | "items" | "done" | "failed";
  lines: string[];
  parse: ReceiptParse | null;
  /** A category id per item of `parse`, in order; null where nothing fitted. */
  cats: (string | null)[];
};

// 2: read at full resolution (KPReceipt.normalized); earlier readings of a long receipt were too small.
// 4: the till layout reads NIEFISKALNY receipts, names on a row of their own, and "Sp.op.A" as tax.
const VERSION = 4;
const IDLE: PhotoReading = { status: "reading", lines: [], parse: null, cats: [] };
const state = new Map<string, PhotoReading>();
const listeners = new Map<string, Set<() => void>>();
const running = new Set<string>();

const keyOf = (uri: string) => decodeURIComponent(uri.split("?")[0]!.split("/").pop() ?? uri);
const cacheDir = () => new Directory(Paths.cache, "photo-text");
const cacheFile = (key: string) => new File(cacheDir(), `${key}.json`);

function publish(key: string, next: PhotoReading) {
  state.set(key, next);
  listeners.get(key)?.forEach((l) => l());
}

function fromDisk(key: string): PhotoReading | null {
  try {
    const f = cacheFile(key);
    if (!f.exists) return null;
    const v = JSON.parse(f.textSync()) as PhotoReading & { v?: number };
    return v.v === VERSION && v.status === "done" ? { status: "done", lines: v.lines, parse: v.parse, cats: v.cats } : null;
  } catch { return null; }
}

function toDisk(key: string, r: PhotoReading) {
  try {
    const d = cacheDir();
    if (!d.exists) d.create();
    cacheFile(key).write(JSON.stringify({ v: VERSION, ...r }));
  } catch { /* a cache that cannot be written is read again next time */ }
}

/** Start reading `uri` unless it is read, being read, or already known to fail. Safe to call often. */
export function readPhoto(uri: string | null | undefined): void {
  if (!uri) return;
  const key = keyOf(uri);
  const known = state.get(key);
  if (running.has(key) || known?.status === "done" || known?.status === "failed") return;
  const cached = fromDisk(key);
  if (cached) { publish(key, cached); return; }
  running.add(key);
  void (async () => {
    let r: PhotoReading = { ...IDLE };
    try {
      const lines = (await KPBridge.readPhotoText(uri)).filter((l) => l.trim());
      r = { ...r, status: lines.length ? "text" : "done", lines };
      publish(key, r);
      if (!lines.length) { toDisk(key, r); return; }
      const parse = await KPBridge.understandReceipt(lines).catch(() => null);
      const items = parse?.items.filter((i) => i.name && i.price > 0) ?? [];
      r = { ...r, status: items.length ? "items" : "done", parse: parse ? { ...parse, items } : null };
      publish(key, r);
      if (items.length) {
        const ids = await KPBridge.sortReceiptItems(items.map((i) => i.name), items.map((i) => i.price), parse?.merchant ?? "").catch(() => []);
        r = { ...r, status: "done", cats: items.map((_, i) => ids[i] || null) };
        publish(key, r);
      }
      toDisk(key, r);
    } catch {
      // What was read before the failure stays on screen; only an empty reading counts as failed.
      publish(key, r.lines.length ? { ...r, status: "done" } : { ...r, status: "failed" });
    } finally { running.delete(key); }
  })();
}

/** The reading of `uri`, re-rendering as each step lands. Starts it if nothing has. */
export function usePhotoReading(uri: string | null | undefined): PhotoReading {
  const key = uri ? keyOf(uri) : "";
  return useSyncExternalStore(
    (cb) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      readPhoto(uri);
      return () => { set.delete(cb); };
    },
    () => (key ? state.get(key) ?? IDLE : IDLE),
  );
}
