/**
 * Development builds only: replace everything on this device with the invented demo dataset — the
 * one the App Store screenshots are taken over (scripts/screenshots/demo-build.ts), built for today
 * in the app's language (English when there is no persona for it).
 *
 * It is built in a throw-away in-memory database and brought in as a backup with **replace**, the
 * same path as Settings → Data management → "Replace everything with a file" (DATA.md rule 2), and
 * for the same reason a backup of what was here is written first and named in the result: undoing
 * it is a replace from that copy. Settings travel with it (the persona's language and home), as a
 * restored file's would.
 */
import * as SQLite from "expo-sqlite";
import { exportBackup, importBackup, setMeta, type Row, type SqlDriver, type SqlParam } from "@kopiyka/core";
import { mutate } from "@/store";
import { backupNow, importSummary } from "@/lib/backup";
import { getLanguage } from "@/i18n";
import { todayLocal } from "@/lib/dates";
import { buildDemo, DEMO_LANGUAGES } from "../../scripts/screenshots/demo-build";

const MESSAGES: Record<string, () => Record<string, string>> = {
  en: () => require("../../scripts/screenshots/i18n/en.json"),
  uk: () => require("../../scripts/screenshots/i18n/uk.json"),
};

/** A database that lives only as long as this call: nothing touches the app's file until the import. */
function memoryDb(): { db: SqlDriver; close: () => void } {
  const native = SQLite.openDatabaseSync(":memory:");
  let depth = 0;
  const db: SqlDriver = {
    run: (sql, params = []) => { native.runSync(sql, params as SQLite.SQLiteBindParams); },
    all: <T extends Row>(sql: string, params: SqlParam[] = []) => native.getAllSync<T>(sql, params as SQLite.SQLiteBindParams),
    get: <T extends Row>(sql: string, params: SqlParam[] = []) => native.getFirstSync<T>(sql, params as SQLite.SQLiteBindParams) ?? undefined,
    transaction: <T>(fn: () => T): T => {
      if (depth > 0) return fn();
      depth++;
      let result!: T;
      try { native.withTransactionSync(() => { result = fn(); }); } finally { depth--; }
      return result;
    },
  };
  return { db, close: () => native.closeSync() };
}

/** Replace this device's data with the demo set. Returns what happened, with the safety copy's name. */
export async function loadDemoData(): Promise<{ summary: string; safety: string | null }> {
  if (!__DEV__) throw new Error("test data is for development builds only");
  const safety = await backupNow("before test data");
  const lang = DEMO_LANGUAGES.includes(getLanguage()) && MESSAGES[getLanguage()] ? getLanguage() : "en";
  const mem = memoryDb();
  try {
    buildDemo(mem.db, { lang, today: todayLocal(), messages: MESSAGES[lang]!() });
    const backup = exportBackup(mem.db, { includeDeleted: false });
    const r = mutate((d) => {
      const report = importBackup(d, backup, { mode: "replace", applySettings: true });
      setMeta(d, "onboarded", "1");
      return report;
    });
    return { summary: importSummary(r, "replace"), safety: safety?.name ?? null };
  } finally {
    mem.close();
  }
}
