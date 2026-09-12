/**
 * Persists the last uncaught JS error to disk so it survives the crash that Metro's console
 * can't show you afterwards (TestFlight, a cold-launch RCTFatal). Installed in ALL builds, not
 * just __DEV__: `installCrashLog()` wraps the global handler and writes synchronously before
 * calling through, so the record is on disk even if the process is torn down immediately after.
 */
import { File, Paths } from "expo-file-system";
import Constants from "expo-constants";

export type CrashRecord = { at: string; fatal: boolean; message: string; stack?: string; version: string };

const FILE_NAME = "last-crash.json";
const file = () => new File(Paths.document, FILE_NAME);

function appVersion(): string {
  const cfg = Constants.expoConfig;
  const build = cfg?.ios?.buildNumber ?? (cfg?.android?.versionCode ? String(cfg.android.versionCode) : undefined);
  return `${cfg?.version ?? "?"}${build ? ` (${build})` : ""}`;
}

/** Writes `error` to last-crash.json, overwriting any previous record. Used by both the global handler and the router's ErrorBoundary. */
export function recordCrash(error: unknown, fatal: boolean): void {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const record: CrashRecord = { at: new Date().toISOString(), fatal, message: e.message, stack: e.stack, version: appVersion() };
    file().write(JSON.stringify(record));
  } catch {
    // Logging a crash must never itself throw.
  }
}

/** Installs the global JS error handler. Call once, at module scope, before anything else runs. */
export function installCrashLog(): void {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, fatal) => {
    recordCrash(error, !!fatal);
    if (__DEV__) console.log("UNCAUGHT", fatal ? "fatal" : "", (error as Error)?.stack ?? error);
    prev(error, fatal);
  });
}

export function readLastCrash(): CrashRecord | null {
  try {
    const f = file();
    if (!f.exists) return null;
    return JSON.parse(f.textSync()) as CrashRecord;
  } catch {
    return null;
  }
}

export function clearLastCrash(): void {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // Best-effort.
  }
}
