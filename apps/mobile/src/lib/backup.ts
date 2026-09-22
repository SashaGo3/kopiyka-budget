/**
 * Automatic backups of this phone's database to iCloud (native/KPBackup.swift stores the files in
 * the app's iCloud container, visible in Files → iCloud Drive → Kopiyka → Backups).
 *
 * Policy (shared with the Mac server through core/backupSchedule.ts): a backup is written shortly
 * after data changed, no more often than every few minutes, and at least once a day; each day keeps
 * its first backup plus the newest ones; days outside the retention window are dropped — that window
 * is the "Keep backups for" setting (`backupPolicy()`), and the dial for how much iCloud storage this
 * all takes.
 *
 * The same container is also how two of your own devices catch up with each other — see
 * "Merging what other devices wrote" at the bottom of this file, and rule 12 in DATA.md.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import { AppState, InteractionManager } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  backupDue, backupFileName, exportBackup, importBackup, getMeta, setMeta, localDay, parseBackupName, retentionPlan,
  DEFAULT_BACKUP_POLICY, type BackupPolicy, type ImportMode,
} from "@kopiyka/core";
import { db } from "@/db";
import { dayLabel, todayLocal } from "@/lib/dates";
import { mutate, notifyChange, onAfterWrite, refreshQueries } from "@/store";
import { getBackupKeepDays } from "@/lib/settings";
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

/** Live policy: `keepDays` follows the "Keep backups for" setting; everything else stays fixed. */
export function backupPolicy(): BackupPolicy { return { ...BACKUP_POLICY, keepDays: getBackupKeepDays() }; }

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
  /** Merge in what other devices back up to the same container. */
  sync: boolean;
  syncing: boolean;
  /** When the container was last checked, and how many rows that merge wrote. */
  lastSync: { at: number; rows: number } | null;
}

const META_ON = "icloud_backup";
const META_AT = "backup_last_at";
const META_FILE = "backup_last_file";
const META_DIRTY = "backup_dirty";
/**
 * Auto-sync. All four describe *this install* rather than your data, so none of them is in
 * `BACKUP_META_KEYS`: carrying `sync_seen` onto another phone would tell it that it had already
 * merged files it has never read (DATA.md rules 7 and 12).
 */
const META_SYNC_ON = "icloud_sync";
const META_SYNC_SEEN = "sync_seen";
const META_SYNC_AT = "sync_last_at";
const META_SYNC_ROWS = "sync_last_rows";

// Meta writes here bypass notifyChange() on purpose: a backup must not count as a data change.
const enabled = () => (getMeta(db, META_ON) ?? "1") === "1";
const syncEnabled = () => (getMeta(db, META_SYNC_ON) ?? "1") === "1";
function lastSyncState(): { at: number; rows: number } | null {
  const at = Number(getMeta(db, META_SYNC_AT) ?? 0);
  return at ? { at, rows: Number(getMeta(db, META_SYNC_ROWS) ?? 0) } : null;
}
const lastAt = () => Number(getMeta(db, META_AT) ?? 0);
const dirty = () => getMeta(db, META_DIRTY) === "1";
const hasData = () => (db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts`)?.n ?? 0) > 0;

let state: BackupState = { supported: native != null, enabled: enabled(), icloud: false, busy: false, error: null, last: null, count: 0, today: 0, dirty: false,
  sync: syncEnabled(), syncing: false, lastSync: lastSyncState() };
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

export function setSyncEnabled(on: boolean): void {
  setMeta(db, META_SYNC_ON, on ? "1" : "0");
  set({ sync: on });
  if (on) void pullFromCloud("switched on");
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
      sync: syncEnabled(), lastSync: lastSyncState(),
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
 *
 * Only names the container actually lists are asked for. `getPhoto` waits a minute for iCloud to
 * hand a file over, which is right for one that is on its way and pure cost for one that was never
 * uploaded — and auto-sync would otherwise pay that minute again at every poll, forever.
 */
export async function restorePhotos(limit = 1000): Promise<number> {
  if (!native || !(await mirrorAvailable())) return 0;
  const have = new Set(localPhotoNames());
  const kept = new Set(await native.photos());
  const wanted = db.all<{ photo: string }>(`SELECT DISTINCT photo FROM transactions WHERE deleted=0 AND photo IS NOT NULL AND photo<>''`).map((r) => r.photo);
  let n = 0;
  for (const name of wanted.filter((p) => !have.has(p) && kept.has(p)).slice(0, limit)) {
    try { await native.getPhoto(name, photoPath(name)); n++; } catch { /* still uploading elsewhere */ }
  }
  return n;
}

/**
 * Delete what the policy no longer keeps. Runs after every backup, and again when the "Keep backups
 * for" window is shortened — the point of shortening it is to get the storage back now, not at the
 * next change.
 *
 * Retention is per container, and another device's backup lives in the same one: deleting one before
 * it has been merged would throw away the only copy of what that device did. So while auto-sync is
 * on, only files this phone has already taken in are allowed to age out.
 */
export async function applyRetention(known?: BackupEntry[], now = new Date()): Promise<number> {
  if (!native) return 0;
  const files = known ?? await listBackups();
  const seen = readSeen();
  let n = 0;
  for (const f of retentionPlan(files, backupPolicy(), now)) {
    if (syncEnabled() && seen !== null && !seen.has(f.name)) continue;
    try { await native.remove(f.day, f.name); n++; } catch { /* next time */ }
  }
  if (n && !known) await refresh();   // after a backup the caller refreshes anyway
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
      // What we just wrote is by definition already in this database, so it never needs merging back.
      const seen = readSeen();
      if (seen) { seen.add(name); writeSeen(seen, files.map((f) => f.name).concat(name)); }
      await applyRetention(files, now);
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
 *
 * `photos: "background"` hands the images off instead of waiting for them. Fetching one that iCloud
 * has not downloaded yet can take up to a minute, which is fine behind a list the user chose a file
 * from and wrong on the welcome screen, where it would hold up the app the restore is meant to open.
 */
export async function restoreBackup(entry: Pick<BackupEntry, "day" | "name">, mode: ImportMode = "merge", opts: { photos?: "wait" | "background" } = {}): Promise<string> {
  if (!native) throw new Error("Backups need the native build");
  const text = await native.read(entry.day, entry.name);
  const r = mutate((d) => importBackup(d, text, { mode }));
  const n = Object.values(r.imported).reduce((a, b) => a + b, 0);
  // The rows name their photos; the images come from the mirror beside the backup.
  if (opts.photos === "background") void restorePhotos().catch(() => { /* the next merge tries again */ });
  const photos = opts.photos === "background" ? 0 : await restorePhotos();
  return `${r.imported.transactions} transactions, ${r.imported.accounts} accounts, ${r.imported.categories} categories, ${r.imported.tags} tags${r.imported.recurring_rules ? `, ${r.imported.recurring_rules} recurring rules` : ""}${r.imported.budgets ? `, ${r.imported.budgets} budgets` : ""}${r.rates ? `, ${r.rates} exchange rates` : ""}${photos ? `, ${photos} photo${photos === 1 ? "" : "s"}` : ""} · ${n} rows in total, ${mode === "replace" ? `${r.removed} removed.` : `${r.skipped} already up to date.`}`;
}

/* ── Merging what other devices wrote ─────────────────────────────────────────────────────────
 *
 * Every device signed in to the same iCloud account backs up into the same container, so the
 * container is already a shared inbox — it only needed reading. This end of it: list the files,
 * take in the ones this install has never read, and merge them.
 *
 * Merge, never replace (DATA.md rule 2): nothing is ever deleted, and a row is written only when
 * the file's copy is newer, so whatever was typed on *this* device since is kept. Deletions still
 * travel, because an automatic backup carries tombstones (rule 8) and a tombstone is a newer row.
 * Settings are deliberately left out — `current_account`, `budget_scope` and the rest say what this
 * device is showing, and a background merge has no business moving another phone's furniture.
 *
 * "Never read" is tracked by file name in `sync_seen`, not by timestamp: two devices write from
 * their own clocks, and a high-water mark would silently skip a file that was written while this
 * phone was offline but stamped earlier than its own last one. The first run seeds the set with
 * everything already in the container — that is this install's own history, and merging a month of
 * our own backups back in would be a lot of work to change nothing at all.
 */

/** How often the container is checked while the app is open. A listing is cheap; a merge only happens when a file is genuinely new. */
export const SYNC_INTERVAL_MS = 5 * 60_000;

/** Names already accounted for — written here, or merged in. `null` = never recorded, i.e. the first run. */
function readSeen(): Set<string> | null {
  const raw = getMeta(db, META_SYNC_SEEN);
  if (raw == null) return null;
  try { const v: unknown = JSON.parse(raw); return new Set(Array.isArray(v) ? (v as string[]) : []); } catch { return new Set(); }
}
/** Stores the set, dropping names whose file is gone so it cannot grow without bound. */
function writeSeen(seen: Iterable<string>, alive?: string[]): void {
  const keep = alive ? new Set(alive) : null;
  setMeta(db, META_SYNC_SEEN, JSON.stringify([...seen].filter((n) => !keep || keep.has(n))));
}

/** Records that the container was looked at, and what the look produced. */
function markChecked(rows: number): void {
  const at = Date.now();
  setMeta(db, META_SYNC_AT, String(at));
  setMeta(db, META_SYNC_ROWS, String(rows));
  set({ lastSync: { at, rows } });
}

let pulling: Promise<number> | null = null;

/**
 * Take in every backup in the container this install has not read yet. Returns how many rows the
 * merge actually wrote — 0 on the ordinary poll, where there is nothing new and the whole thing
 * costs one directory listing.
 */
export function pullFromCloud(reason = "poll"): Promise<number> {
  if (pulling) return pulling;
  pulling = (async () => {
    if (!native || !syncEnabled()) return 0;
    try {
      const files = await listBackups();
      const names = files.map((f) => f.name);
      const seen = readSeen();
      // First run. An install that has data of its own seeds the set: the container is that install's
      // own history and merging a month of it back in changes nothing. An install with *no* data is a
      // device that has not been set up yet, and what is in the container is the user's data waiting
      // to come back — that is the welcome flow's decision (`findRestorable`), so the set is left
      // unwritten for it rather than quietly marking the lot as read.
      if (seen === null) { if (hasData()) { writeSeen(names); markChecked(0); } return 0; }
      const fresh = files.filter((f) => !seen.has(f.name)).sort((a, z) => a.time - z.time);   // oldest first, so the newest row wins last
      if (!fresh.length) { writeSeen(seen, names); markChecked(0); return 0; }
      set({ syncing: true, error: null });
      // Parsing a backup and writing it through SQLite both happen on the JS thread, so the merge
      // waits for whatever the user is doing — a scroll, a keypad tap, a sheet dismissal — to finish.
      await new Promise<void>((resolve) => { InteractionManager.runAfterInteractions(() => resolve()); });
      let rows = 0;
      for (const f of fresh) {
        let text: string;
        // A file still coming down from iCloud simply is not here yet: leave it unseen and let the
        // next poll have it. Anything past that point has been read, so it is marked either way —
        // a file we cannot parse will not parse any better in five minutes.
        try { text = await native.read(f.day, f.name); } catch { continue; }
        seen.add(f.name);
        try {
          const r = importBackup(db, text, { mode: "merge", applySettings: false });
          rows += Object.values(r.imported).reduce((a, b) => a + b, 0) + r.rates;
        } catch (e) { if (__DEV__) console.log(`[sync] ${f.name} unreadable: ${(e as Error).message}`); }
      }
      writeSeen(seen, names);
      markChecked(rows);
      if (__DEV__) console.log(`[sync] ${reason}: ${fresh.length} new file(s), ${rows} rows`);
      // Only a merge that changed something is a change: telling the app otherwise would mark the
      // database dirty, write a backup about nothing, and hand the other device a file to merge back.
      if (rows) {
        notifyChange();
        // Only names the container actually has are asked for, so this is bounded work on files
        // that exist; anything past the cap comes down on the next merge.
        void restorePhotos(200).catch(() => { /* the next pull picks up the rest */ });
      }
      return rows;
    } catch (e) {
      set({ error: (e as Error).message });
      return 0;
    } finally {
      pulling = null;
      set({ syncing: false });
      await refresh();
    }
  })();
  return pulling;
}

/**
 * The newest backup this install has never accounted for, if there is one — what a device with no
 * data of its own should offer to become (`app/onboarding/index.tsx`).
 *
 * "Never accounted for" is the same `sync_seen` set auto-sync keeps, and that is what makes this
 * safe to run automatically: after "Erase this phone" the set survives the wipe (`eraseAll` clears
 * `onboarded`, not the meta around it), so the data the user has just deleted is not waiting on the
 * welcome screen to put itself back.
 */
export async function findRestorable(): Promise<BackupEntry | null> {
  if (!native || !syncEnabled()) return null;
  const files = await listBackups();   // newest first
  const newest = files[0];
  if (!newest) return null;
  const seen = readSeen();
  return seen?.has(newest.name) ? null : newest;
}

/** "I have decided about these": marks everything now in the container as accounted for. */
export async function markContainerSeen(): Promise<void> {
  if (!native) return;
  const files = await listBackups();
  const names = files.map((f) => f.name);
  const seen = readSeen() ?? new Set<string>();
  for (const n of names) seen.add(n);
  writeSeen(seen, names);
  await refresh();
}

/** The shortest a pull-to-refresh spinner may last, so the gesture always reads as having done something. */
const REFRESH_MIN_MS = 500;

/**
 * Pull-to-refresh on a main screen: re-read the database *and* look in iCloud, one gesture for both
 * reasons the numbers can be stale. The database is re-read because a Shortcut automation or the
 * watch can write into it while the app is suspended and nothing tells JS about that; the container
 * is checked because another device may have left a backup there.
 *
 * Transactions and Budgets share this so the gesture means the same thing on both. The spinner is
 * held for a moment: a poll that finds nothing returns almost instantly, and a spinner that vanishes
 * before it is seen reads as a gesture that did not register.
 */
export function useCloudRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshQueries();
    const started = Date.now();
    void pullFromCloud("pull to refresh").finally(() => {
      setTimeout(() => setRefreshing(false), Math.max(0, REFRESH_MIN_MS - (Date.now() - started)));
    });
  }, []);
  return { refreshing, onRefresh };
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void tick(); }, ms);
}

/** Take in whatever the other devices left, then decide whether a backup is due and take it. */
export async function tick(): Promise<void> {
  if (!native) return;
  // Pull before push, so the backup this writes is the union rather than half the story.
  await pullFromCloud("tick");
  if (!enabled() || !hasData()) return;
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
  // iCloud hands a file over when it feels like it, and there is no notification for it, so the
  // container is looked at every few minutes while the app is open. Nothing is read unless a name
  // in it is new, which is why this can afford to be a plain interval.
  setInterval(() => { if (AppState.currentState === "active") void pullFromCloud(); }, SYNC_INTERVAL_MS);
  void refresh().then(() => tick());
}
