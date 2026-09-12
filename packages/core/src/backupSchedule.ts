/**
 * Backup naming and retention shared by the phone (iCloud) and the Mac server (iCloud Drive).
 * Pure functions: the caller lists, writes and deletes files.
 *
 * Layout:  <dir>/2026-09-08/kopiyka-2026-09-08T14-05-33.json
 *
 * Policy:
 *   - at most `perDay` files per calendar day: the day's first backup is always kept (the
 *     "start of day" state) and the newest ones fill the remaining slots;
 *   - days older than `keepDays` are dropped (0 = keep forever);
 *   - a backup is due when data changed since the last one (after a quiet `debounceMs`, and no
 *     more often than `minIntervalMs`), and at least once a day even without changes.
 */
export interface BackupPolicy {
  perDay: number;
  keepDays: number;
  minIntervalMs: number;
  debounceMs: number;
}

export const DEFAULT_BACKUP_POLICY: BackupPolicy = { perDay: 7, keepDays: 30, minIntervalMs: 30 * 60_000, debounceMs: 5 * 60_000 };

export interface BackupEntry { name: string; day: string; time: number }

const NAME_RE = /^kopiyka-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/;
export const BACKUP_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string { return String(n).padStart(2, "0"); }
/** Calendar day in local time, the way the user thinks about "today". */
export function localDay(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function backupFileName(d: Date): string { return `kopiyka-${localDay(d)}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.json`; }

export function parseBackupName(name: string): { day: string; time: number } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, day, h, mi, s] = m as unknown as [string, string, string, string, string];
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  return { day, time: new Date(y, mo - 1, d, Number(h), Number(mi), Number(s)).getTime() };
}

/** Which files the policy says to delete. */
export function retentionPlan<T extends BackupEntry>(files: T[], policy: Pick<BackupPolicy, "perDay" | "keepDays">, now: Date): T[] {
  const doomed: T[] = [];
  const cutoff = policy.keepDays > 0 ? localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - policy.keepDays + 1)) : "";
  const byDay = new Map<string, T[]>();
  for (const f of files) {
    if (cutoff && f.day < cutoff) { doomed.push(f); continue; }
    (byDay.get(f.day) ?? byDay.set(f.day, []).get(f.day)!).push(f);
  }
  for (const dayFiles of byDay.values()) {
    const sorted = [...dayFiles].sort((a, b) => a.time - b.time);
    const excess = sorted.length - Math.max(1, policy.perDay);
    if (excess <= 0) continue;
    doomed.push(...sorted.slice(1, 1 + excess));
  }
  return doomed;
}

export type BackupDue = "changes" | "daily" | "wait" | null;

/**
 * Whether a backup should be taken now. `wait` means data changed but the interval has not
 * passed yet (call again later).
 */
export function backupDue(o: { now: Date; changed: boolean; lastAt: number; hasToday: boolean; minIntervalMs: number }): BackupDue {
  if (!o.changed && o.hasToday) return null;
  if (!o.changed) return "daily";
  if (o.hasToday && o.now.getTime() - o.lastAt < o.minIntervalMs) return "wait";
  return "changes";
}
