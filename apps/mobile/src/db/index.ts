/**
 * Phone database. Opened synchronously at module load so the first screen can
 * read data before the first paint. Lives in the App Group container when one is
 * available so WidgetKit, App Intents and the watch bridge can read the same file.
 */
import * as SQLite from "expo-sqlite";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { migrate, type Row, type SqlDriver, type SqlParam } from "@kopiyka/core";
import { KPBridge } from "@/lib/bridge";

export const APP_GROUP = "group.dev.kopiyka";
export const DB_NAME = "kopiyka.db";

function sharedDirectory(): string | undefined {
  if (Platform.OS !== "ios") return undefined;
  try {
    const dir = Paths.appleSharedContainers[APP_GROUP];
    return dir?.uri.replace(/^file:\/\//, "").replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export const dbDirectory = sharedDirectory();
// From here on the watch bridge and App Intents forward their writes to JS instead of writing the
// file with the system SQLite (two SQLite copies in one process corrupt each other's WAL).
KPBridge.claimDatabase();
const native = SQLite.openDatabaseSync(DB_NAME, { useNewConnection: false }, dbDirectory);
native.execSync("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON;");

let depth = 0;
export const db: SqlDriver = {
  run: (sql, params = []) => { native.runSync(sql, params as SQLite.SQLiteBindParams); },
  all: <T extends Row>(sql: string, params: SqlParam[] = []) => native.getAllSync<T>(sql, params as SQLite.SQLiteBindParams),
  get: <T extends Row>(sql: string, params: SqlParam[] = []) => (native.getFirstSync<T>(sql, params as SQLite.SQLiteBindParams) ?? undefined),
  transaction: <T>(fn: () => T): T => {
    if (depth > 0) return fn();
    depth++;
    let result!: T;
    try { native.withTransactionSync(() => { result = fn(); }); } finally { depth--; }
    return result;
  },
};

migrate(db);

/** Size of the on-disk database file, in bytes (0 if it cannot be read). */
export function databaseFileSize(): number {
  try { return new File(dbDirectory ?? Paths.document, DB_NAME).size ?? 0; } catch { return 0; }
}

/** Reclaims space left by soft-deleted rows and past index rebuilds. Must not run inside a transaction. Returns the size afterward. */
export function compactDatabase(): number {
  db.run("VACUUM");
  return databaseFileSize();
}

// Indexes damaged by an earlier concurrent native write (builds before 2026-09-08) are rebuilt once;
// `quick_check` on this small file takes a few milliseconds.
try {
  const check = native.getFirstSync<{ quick_check: string }>("PRAGMA quick_check")?.quick_check;
  if (check && check !== "ok") { native.execSync("REINDEX"); console.warn("[db] rebuilt indexes:", check); }
} catch (e) { console.warn("[db] integrity check failed", e); }
