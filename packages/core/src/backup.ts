/**
 * Full data export: every table with every field (icons, colours, recurring rules,
 * budgets, tags, settings). JSON so nothing is lost in translation, and it can be
 * imported back (newer rows win).
 *
 * The rules this file enforces — the id is the identity, merge never deletes, replace does, rates
 * and tombstones are not litter to be tidied away — are written out in DATA.md at the repo root.
 * Read it before changing anything here.
 */
import type { SqlDriver } from "./db";
import { nowMs } from "./db";
import type { RowByTable, Synced, SyncedTable } from "./models";
import { DEFAULT_DEBT_NOTIFY_TIME, SYNCED_TABLES } from "./models";
import { getMeta, setMeta } from "./schema";
import { getRow, listRows, upsertRaw } from "./repo";

export const BACKUP_FORMAT = "kopiyka-backup";
export const BACKUP_VERSION = 1;
/**
 * Local preferences carried in a backup. The `meta` table also holds things that describe *this
 * install* rather than your data, and those are deliberately left out:
 *
 * - `device_id`, `last_pulled_seq` — left over from the sync protocol this app no longer has; nothing
 *   writes them anymore, but an old backup might still carry them, and restoring either onto another
 *   phone would be nonsensical, so they stay excluded.
 * - `onboarded` — whether this install has been set up, which the restore itself decides.
 *
 * Anything else a preference getter reads belongs here. A key that is written but missing from this
 * list is silently lost on restore, which is how `hide_income`, `show_balance`, `backup_per_day` and
 * the home location went missing until 2026-09-12 — the list also carried `hide_balances`, a key
 * nothing had written since it was renamed. `backup.test.ts` pins the list so the next drift shows
 * up in a diff. A preference that is removed from the app comes off this list too (`handedness`,
 * 2026-09-12): an old backup still carrying the key is simply ignored on import.
 */
export const BACKUP_META_KEYS = [
  "period_start_day", "base_currency", "recurring_notify_days_before",
  "location_enabled", "home_lat", "home_lon", "home_place",
  "current_account", "budget_scope", "hide_income", "show_balance", "backup_per_day", "shortcut_notify",
  // "" (or absent) means the app follows the phone's own language, so a restore onto a phone set to
  // another language does the right thing without the backup having to say so.
  "language",
] as const;

/**
 * One cached exchange rate. These look like a cache and are not one: `cachedRate` looks a rate up
 * *by day*, so the row for the day of a 2021 transfer is what makes that transfer still convert
 * correctly today. Some of it cannot be fetched again either — the rate source covers a fixed list of
 * currencies and only so far back, and a rate entered by hand was never fetched at all. So rates
 * travel with the backup; they are a handful of numbers per currency pair.
 */
export interface BackupRate { base: string; quote: string; day: string; rate: number; fetched_at: number; [k: string]: unknown }

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  settings: Record<string, string>;
  accounts: RowByTable["accounts"][];
  categories: RowByTable["categories"][];
  tags: RowByTable["tags"][];
  transactions: RowByTable["transactions"][];
  recurring_rules: RowByTable["recurring_rules"][];
  budgets: RowByTable["budgets"][];
  insights?: RowByTable["insights"][];
  debts?: RowByTable["debts"][];
  rates?: BackupRate[];
}

const TOMBSTONE_AGE_MS = 30 * 24 * 60 * 60_000;

/** Drops null-valued keys; a tombstone (deleted, and old enough that its content no longer matters) shrinks to just id/updated_at/deleted. */
function compactRow<T extends Synced>(row: T, tombstoneCutoff: number): T {
  if (row.deleted === 1 && row.updated_at < tombstoneCutoff) return { id: row.id, updated_at: row.updated_at, deleted: 1 } as T;
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  return out as T;
}

export function exportBackup(db: SqlDriver, opts: { includeDeleted?: boolean; now?: () => Date; compact?: boolean } = {}): Backup {
  const where = opts.includeDeleted ? "1=1" : "deleted=0";
  const settings: Record<string, string> = {};
  for (const k of BACKUP_META_KEYS) { const v = getMeta(db, k); if (v != null) settings[k] = v; }
  const now = opts.now?.() ?? new Date();
  const tombstoneCutoff = now.getTime() - TOMBSTONE_AGE_MS;
  const pick = <T extends SyncedTable>(t: T) => {
    const rows = listRows(db, t, where, [], "rowid");
    return opts.compact ? rows.map((r) => compactRow(r, tombstoneCutoff)) : rows;
  };
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: now.toISOString(), settings,
    accounts: pick("accounts"), categories: pick("categories"), tags: pick("tags"),
    transactions: pick("transactions"), recurring_rules: pick("recurring_rules"), budgets: pick("budgets"), insights: pick("insights"),
    debts: pick("debts"),
    rates: db.all<BackupRate>(`SELECT base, quote, day, rate, fetched_at FROM exchange_rates ORDER BY base, quote, day`),
  };
}

export function exportBackupJson(db: SqlDriver): string {
  return JSON.stringify(exportBackup(db), null, 1);
}

/**
 * Fallbacks for columns a compact export dropped: `null` for nullable columns (matches what a
 * compact export omits), a harmless placeholder for columns that are NOT NULL with no SQL default
 * (only reached by an old, content-stripped tombstone; the row stays deleted=1 either way).
 */
const ROW_DEFAULTS: Record<SyncedTable, Record<string, unknown>> = {
  accounts: { name: "", currency: "", type: "bank", group_name: "", icon: null, color: null, sort: 0, archived: 0, include_in_net_worth: 1, opening_balance_minor: 0 },
  categories: { name: "", parent_id: null, icon: null, color: null, sort: 0, kind: "expense", description: null },
  tags: { name: "", color: null, category_ids: "[]" },
  transactions: { account_id: "", date: "1970-01-01T00:00:00Z", amount_minor: 0, category_id: null, payee: null, notes: null, tag_ids: "[]",
    pending: 0, transfer_id: null, entered_amount_minor: null, entered_currency: null, exchange_rate: null, recurring_id: null,
    lat: null, lon: null, place: null, photo: null, source: null },
  recurring_rules: { account_id: "", amount_minor: 0, category_id: null, payee: null, notes: null, tag_ids: "[]", frequency: "monthly",
    interval: 1, start_date: "1970-01-01", end_date: null, next_date: "1970-01-01", notify: 1, notify_days_before: 0, auto_post: 0,
    active: 1, time_of_day: "09:00" },
  budgets: { category_id: null, currency: "", amount_minor: 0, period: "monthly", starts: "1970-01-01", start_day: 1, account_id: null,
    tag_id: null, ends: null, ended: null },
  insights: { kind: "", params: "{}", sort: 0 },
  debts: { person: "", direction: "owed_to_me", amount_minor: 0, currency: "", account_id: null, opened_date: "1970-01-01", due_date: null, notes: null, settled_date: null, notify: 1, notify_time: DEFAULT_DEBT_NOTIFY_TIME, transaction_id: null },
};

/** Fills in columns a compact row lacks; present values always win. */
function withDefaults<T extends SyncedTable>(table: T, row: Partial<RowByTable[T]>): RowByTable[T] {
  return { ...ROW_DEFAULTS[table], ...row } as unknown as RowByTable[T];
}

export interface BackupReport { imported: Record<SyncedTable, number>; skipped: number; settings: number; rates: number; removed: number }

/**
 * How an import treats what is already on the phone.
 *
 * - `merge` (the default, and what a routine restore does): rows are upserted when the file's copy is
 *   newer, and nothing is ever deleted. Two devices, or a phone and an old backup, converge.
 * - `replace`: the file becomes the whole truth. Its rows are written as they stand — even when the
 *   phone's copy is newer — and every row the file does not mention is deleted outright. This is the
 *   mode for an export you have restructured elsewhere, where the point is that the categories you
 *   removed actually go, instead of quietly surviving as rows the file no longer mentions.
 *
 * `replace` does not touch the exchange rates: a restructured export is about categories and tags,
 * and the rate the day of a 2021 transfer used is not something a rewrite should be able to drop.
 */
export type ImportMode = "merge" | "replace";

/** Bring a backup in. See `ImportMode` for what `merge` and `replace` each mean. */
export function importBackup(db: SqlDriver, input: string | Backup, opts: { applySettings?: boolean; mode?: ImportMode } = {}): BackupReport {
  const b = (typeof input === "string" ? JSON.parse(input) : input) as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT || !Array.isArray(b.accounts)) throw new Error("Not a Kopiyka backup");
  const replace = opts.mode === "replace";
  const report: BackupReport = { imported: { accounts: 0, categories: 0, tags: 0, transactions: 0, recurring_rules: 0, budgets: 0, insights: 0, debts: 0 }, skipped: 0, settings: 0, rates: 0, removed: 0 };
  db.transaction(() => {
    for (const t of SYNCED_TABLES) {
      const keep = new Set<string>();
      for (const row of (b[t] ?? []) as RowByTable[typeof t][]) {
        if (!row?.id) { report.skipped++; continue; }
        keep.add(row.id);
        const existing = getRow(db, t, row.id);
        // Replacing, the file wins even when the phone's row is newer — that is the whole point of
        // handing back an export you have edited.
        if (!replace && existing && existing.updated_at >= row.updated_at) { report.skipped++; continue; }
        const filled = withDefaults(t, row);
        upsertRaw(db, t, { ...filled, updated_at: Math.max(row.updated_at ?? 0, 1) } as RowByTable[typeof t]);
        db.run(`INSERT OR IGNORE INTO sync_outbox(tbl, id) VALUES (?, ?)`, [t, row.id]);
        report.imported[t]++;
      }
      // Anything the file does not mention is gone. Deleted outright rather than tombstoned: the file
      // is the new truth, and a tombstone would only make the next export carry rows about nothing.
      if (replace) {
        for (const row of listRows(db, t, "1=1")) {
          if (keep.has(row.id)) continue;
          db.run(`DELETE FROM ${t} WHERE id=?`, [row.id]);
          report.removed++;
        }
      }
    }
    if (replace) { db.run(`DELETE FROM sync_outbox`); db.run(`DELETE FROM change_log`); db.run(`DELETE FROM meta WHERE key='last_pulled_seq'`); }
    // Rates are keyed by (base, quote, day) rather than by id, so "newer wins" is `fetched_at`:
    // a rate this phone looked up (or was given) more recently is not overwritten by an older backup.
    for (const r of b.rates ?? []) {
      if (!r?.base || !r.quote || !r.day || typeof r.rate !== "number") { report.skipped++; continue; }
      const cur = db.get<{ fetched_at: number }>(`SELECT fetched_at FROM exchange_rates WHERE base=? AND quote=? AND day=?`, [r.base, r.quote, r.day]);
      if (cur && cur.fetched_at >= (r.fetched_at ?? 0)) { report.skipped++; continue; }
      db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, [r.base, r.quote, r.day, r.rate, r.fetched_at ?? 0]);
      report.rates++;
    }
    if (opts.applySettings !== false) for (const [k, v] of Object.entries(b.settings ?? {})) { if ((BACKUP_META_KEYS as readonly string[]).includes(k)) { setMeta(db, k, String(v)); report.settings++; } }
  });
  return report;
}

export { nowMs as backupNow };
