/**
 * The notification automation's own log (native/KPParseLog.swift).
 *
 * The automation runs with the app closed and says nothing, which is the point of it — but a bank
 * whose wording the reader does not know yet then loses purchases silently. So every notification it
 * is handed leaves a line here, and this is how the app reads them back.
 *
 * A file in the app group rather than a table: the intent must not open the database while JS owns
 * it, and a diagnostic log has no business travelling in a backup. It holds whole notification texts,
 * so it never leaves the phone unless the user exports it.
 */
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { toCsv } from "@kopiyka/core";
import { APP_GROUP } from "@/db";

export const PARSE_LOG_FILE = "parse-log.jsonl";

/** What became of one notification; mirrors `KPParseLog.Outcome`. */
export type ParseOutcome = "logged" | "pending" | "duplicate" | "unreadable" | "ignored" | "failed";

export interface ParseEntry {
  at: string;
  outcome: ParseOutcome;
  text: string;
  amount?: number | null;
  currency?: string | null;
  merchant?: string | null;
  card?: string | null;
  account?: string | null;
  note?: string | null;
}

/** The outcomes that did not end in a row. What the log is for. */
export const UNLOGGED: ParseOutcome[] = ["unreadable", "ignored", "failed"];

function logFile(): File | null {
  if (Platform.OS !== "ios") return null;
  const dir: Directory | undefined = Paths.appleSharedContainers[APP_GROUP];
  return dir ? new File(dir, PARSE_LOG_FILE) : null;
}

/** Newest first. A half-written last line (the app was killed mid-append) is skipped, not thrown. */
export function readParseLog(): ParseEntry[] {
  try {
    const f = logFile();
    if (!f?.exists) return [];
    const out: ParseEntry[] = [];
    for (const line of f.textSync().split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as ParseEntry); } catch { /* a torn line is not worth losing the rest over */ }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

export function clearParseLog(): void {
  const f = logFile();
  if (f?.exists) f.delete();
}

const CSV_COLUMNS = ["at", "outcome", "amount", "currency", "merchant", "card", "account", "note", "text"] as const;

/** One row per notification, through the same writer as the transactions export. */
export function parseLogCsv(entries: ParseEntry[]): string {
  return toCsv(entries.map((e) => ({ ...e, amount: e.amount ?? "", note: e.note ?? "" })), [...CSV_COLUMNS]);
}
