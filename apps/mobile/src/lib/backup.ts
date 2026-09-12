/**
 * Automatic backups of this phone's database to iCloud (native/KPBackup.swift stores the files in
 * the app's iCloud container, visible in Files → iCloud Drive → Kopiyka → Backups).
 *
 * Policy (shared with the Mac server through core/backupSchedule.ts): a backup is written shortly
 * after data changed, no more often than every few minutes, and at least once a day; each day keeps
 * its first backup plus the newest ones (how many is the "Backups per day" setting, `backupPolicy()`);
 * older days are dropped after 30 days.
 */
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  backupDue, backupFileName, exportBackup, importBackup, getMeta, setMeta, localDay, parseBackupName, retentionPlan,
  DEFAULT_BACKUP_POLICY, type BackupPolicy, type ImportMode,
} from "@kopiyka/core";
import { db } from "@/db";
import { dayLabel, todayLocal } from "@/lib/dates";
import { mutate, onAfterWrite } from "@/store";
import { getBackupPerDay } from "@/lib/settings";
import { localPhotoNames, photoPath } from "@/lib/photos";

type Native = {
  location(): Promise<{ dir: string; icloud: boolean; available: boolean }>;
  list(): Promise<{ name: string; day: string; size: number; downloaded: boolean }[]>;
  write(day: string, name: string, contents: string): Promise<string>;
  read(day: string, name: string): Promise<string>;
  remove(day: string, name: string): Promise<void>;
  photos(): Promise<string[]>;
  putPhoto(name: string, path: string): Promise<void>;
  getPhoto(name: string, path: string): Promise<void>;
};
const native = requireOptionalNativeModule<Native>("KPBackup");

/** Phones get fewer chances to run than a server: back up sooner, and allow one every 5 minutes. */
export const BACKUP_POLICY: BackupPolicy = { ...DEFAULT_BACKUP_POLICY, debounceMs: 20_000, minIntervalMs: 5 * 60_000 };

/** Live policy: perDay follows the "Backups per day" setting; debounce/interval stay fixed. */
export function backupPolicy(): BackupPolicy { return { ...BACKUP_POLICY, perDay: getBackupPerDay() }; }

export interface BackupEntry { name: string; day: string; time: number; size: number; downloaded: boolean }

export interface BackupState {
  supported: boolean;
  enabled: boolean;
  /** Signed in to iCloud; otherwise files stay in the app's Documents folder. */
  icloud: boolean;
  busy: boolean;
  error: string | null;
  last: { at: number; file: string } | null;
  count: number;
  today: number;
  /** Data changed since the last backup. */
  dirty: boolean;
}

const META_ON = "icloud_backup";
const META_AT = "backup_last_at";
const META_FILE = "backup_last_file";
const META_DIRTY = "backup_dirty";

// Meta writes here bypass notifyChange() on purpose: a backup must not count as a data change.
const enabled = () => (getMeta(db, META_ON) ?? "1") === "1";
const lastAt = () => Number(getMeta(db, META_AT) ?? 0);
const dirty = () => getMeta(db, META_DIRTY) === "1";
const hasData = () => (db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts`)?.n ?? 0) > 0;

let state: BackupState = { supported: native != null, enabled: enabled(), icloud: false, busy: false, error: null, last: null, count: 0, today: 0, dirty: false };
const subs = new Set<() => void>();
function set(patch: Partial<BackupState>) { state = { ...state, ...patch }; for (const s of subs) s(); }
export function getBackupState(): BackupState { return state; }
/** "Last backup Today at 19:21" / "No backup yet" — one phrasing for Settings and Data management.
 *  Day and time must both come from the local clock: taking the day off `toISOString()` (UTC) beside a
 *  local time read "Yesterday" for a backup made minutes earlier. */
export function lastBackupLine(at: number | undefined): string {
  if (!at) return "No backup yet";
  const d = new Date(at);
  return `Last backup ${dayLabel(todayLocal(d))} at ${d.toTimeString().slice(0, 5)}`;
}

export function useBackupState(): BackupState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state, () => state);
}

export function setBackupEnabled(on: boolean): void {
  setMeta(db, META_ON, on ? "1" : "0");
  set({ enabled: on });
  if (on) void tick();
}

/** Newest first. */
export async function listBackups(): Promise<BackupEntry[]> {
  if (!native) return [];
  const raw = await native.list();
  return raw.flatMap((f) => { const p = parseBackupName(f.name); return p ? [{ ...f, time: p.time }] : []; })
    .sort((a, b) => b.time - a.time);
}

async function refresh(): Promise<void> {
  if (!native) return;
  try {
    const [loc, files] = await Promise.all([native.location(), listBackups()]);
    const at = lastAt();
    set({
      icloud: loc.icloud, enabled: enabled(), dirty: dirty(), error: null,
      last: at ? { at, file: getMeta(db, META_FILE) ?? "" } : null,
      count: files.length, today: files.filter((f) => f.day === localDay(new Date())).length,
    });
  } catch (e) { set({ error: (e as Error).message }); }
}

/**
 * Photos are mirrored beside the backups, never inside them (native/KPBackup.swift explains why).
 * A photo file is written once and never changed, so the mirror is a set difference: copy the names
 * the container has not got. A few per run keeps it off the back of a backup that should be quick,
 * and the rest go on the next one — there is no deadline, only eventual completeness.
 */
const PHOTO_BATCH = 25;

export interface PhotoBackupState { local: number; kept: number; pending: number; icloud: boolean }

/**
 * The mirror only runs when iCloud does. Without it the container falls back to the app's own
 * Documents folder, where the mirror would sit beside the photos it is copying — `Photos` next to
 * `photos`, the same directory on a case-insensitive filesystem. Copying a file onto itself would
 * quietly succeed and the screen would then claim everything was safely backed up, which is the one
 * thing a backup must never get wrong. Off iCloud there is no second place to put them anyway.
 */
async function mirrorAvailable(): Promise<boolean> {
  if (!native) return false;
  try { return (await native.location()).icloud; } catch { return false; }
}

export async function photoBackupState(): Promise<PhotoBackupState> {
  const local = localPhotoNames().length;
  if (!(await mirrorAvailable())) return { local, kept: 0, pending: local, icloud: false };
  const kept = new Set(await native!.photos());
  return { local, kept: kept.size, pending: localPhotoNames().filter((n) => !kept.has(n)).length, icloud: true };
}

/** Copy over the photos this device has and the backup has not. Returns how many were copied. */
export async function mirrorPhotos(limit = PHOTO_BATCH): Promise<number> {
  if (!native || !(await mirrorAvailable())) return 0;
  const kept = new Set(await native.photos());
  let n = 0;
  for (const name of localPhotoNames().filter((p) => !kept.has(p)).slice(0, limit)) {
    try { await native.putPhoto(name, photoPath(name)); n++; } catch { /* next backup tries again */ }
  }
  return n;
}

/**
 * Fetch the photos the database points at but this device has not got — what a restore needs, since
 * the rows come back from the JSON and the images do not. A name with no file behind it is skipped:
 * it predates the mirror, or was taken on a phone that never finished uploading it.
 */
export async function restorePhotos(limit = 1000): Promise<number> {
  if (!native || !(await mirrorAvailable())) return 0;
  const have = new Set(localPhotoNames());
  const wanted = db.all<{ photo: string }>(`SELECT DISTINCT photo FROM transactions WHERE deleted=0 AND photo IS NOT NULL AND photo<>''`).map((r) => r.photo);
  let n = 0;
  for (const name of wanted.filter((p) => !have.has(p)).slice(0, limit)) {
    try { await native.getPhoto(name, photoPath(name)); n++; } catch { /* gone, or still uploading elsewhere */ }
  }
  return n;
}

let inflight: Promise<BackupEntry | null> | null = null;

/** Write a backup now (also applies retention). Resolves null when unsupported or empty. */
export function backupNow(reason = "manual"): Promise<BackupEntry | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!native || !hasData()) return null;
    set({ busy: true, error: null });
    try {
      const now = new Date();
      const day = localDay(now), name = backupFileName(now);
      const json = JSON.stringify(exportBackup(db, { includeDeleted: true, now: () => now, compact: true }));
      await native.write(day, name, json);
      setMeta(db, META_AT, String(now.getTime()));
      setMeta(db, META_FILE, name);
      setMeta(db, META_DIRTY, "0");
      const files = await listBackups();
      for (const f of retentionPlan(files, backupPolicy(), now)) { try { await native.remove(f.day, f.name); } catch { /* next time */ } }
      if (__DEV__) console.log(`[backup] ${reason}: ${name} ${(json.length / 1024).toFixed(0)} KB`);
      // Deliberately not awaited: the backup itself is done, and copying images must not hold up
      // the app or push the next backup's interval out.
      void mirrorPhotos().catch(() => { /* next backup tries again */ });
      return { name, day, time: now.getTime(), size: json.length, downloaded: true };
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    } finally {
      inflight = null;
      set({ busy: false });
      await refresh();
    }
  })();
  return inflight;
}

/**
 * Bring a backup into the phone. `merge` (the default) lets newer rows win and deletes nothing;
 * `replace` makes the backup the whole database, which is how you undo a replace that went wrong.
 * Returns a human summary.
 */
export async function restoreBackup(entry: Pick<BackupEntry, "day" | "name">, mode: ImportMode = "merge"): Promise<string> {
  if (!native) throw new Error("Backups need the native build");
  const text = await native.read(entry.day, entry.name);
  const r = mutate((d) => importBackup(d, text, { mode }));
  const n = Object.values(r.imported).reduce((a, b) => a + b, 0);
  // The rows name their photos; the images come from the mirror beside the backup.
  const photos = await restorePhotos();
  return `${r.imported.transactions} transactions, ${r.imported.accounts} accounts, ${r.imported.categories} categories, ${r.imported.tags} tags${r.imported.recurring_rules ? `, ${r.imported.recurring_rules} recurring rules` : ""}${r.imported.budgets ? `, ${r.imported.budgets} budgets` : ""}${r.rates ? `, ${r.rates} exchange rates` : ""}${photos ? `, ${photos} photo${photos === 1 ? "" : "s"}` : ""} · ${n} rows in total, ${mode === "replace" ? `${r.removed} removed.` : `${r.skipped} already up to date.`}`;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void tick(); }, ms);
}

/** Decide whether a backup is due and take it. */
export async function tick(): Promise<void> {
  if (!native || !enabled() || !hasData()) return;
  const now = new Date();
  let hasToday = state.today > 0;
  if (!hasToday) { try { hasToday = (await native.list()).some((f) => f.day === localDay(now)); } catch { /* treat as none */ } }
  const due = backupDue({ now, changed: dirty(), lastAt: lastAt(), hasToday, minIntervalMs: BACKUP_POLICY.minIntervalMs });
  if (due === "wait") { schedule(Math.max(1000, lastAt() + BACKUP_POLICY.minIntervalMs - now.getTime())); return; }
  if (due) await backupNow(due);
}

let installed = false;
/** After each write: mark dirty and back up once things go quiet. Leaving the app flushes; returning checks the daily one. */
export function installBackupTriggers(): void {
  if (installed || !native) return;
  installed = true;
  onAfterWrite(() => {
    if (!enabled()) return;
    setMeta(db, META_DIRTY, "1");
    set({ dirty: true });
    schedule(BACKUP_POLICY.debounceMs);
  });
  AppState.addEventListener("change", (s) => {
    if (s === "active") void tick();
    else if (dirty()) { if (timer) { clearTimeout(timer); timer = null; } void tick(); }
  });
  void refresh().then(() => tick());
}
