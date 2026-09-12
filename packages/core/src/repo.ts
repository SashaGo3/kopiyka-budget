import type { SqlDriver, SqlParam, Row } from "./db";
import { nowMs } from "./db";
import { newId } from "./ids";
import { getMeta, setMeta } from "./schema";
import { DEFAULT_ACCOUNT_GROUP, DEFAULT_DEBT_NOTIFY_TIME } from "./models";
import type { Account, Budget, Category, Debt, Insight, RecurringRule, RowByTable, Synced, SyncedTable, Tag, Transaction } from "./models";
import { SYNCED_TABLES } from "./models";

/** Column lists per table, excluding the shared sync columns. Order matters for upsert SQL. */
export const TABLE_COLUMNS: Record<SyncedTable, string[]> = {
  accounts: ["name", "currency", "type", "group_name", "icon", "color", "sort", "archived", "include_in_net_worth", "opening_balance_minor"],
  categories: ["name", "parent_id", "icon", "color", "sort", "kind", "description"],
  tags: ["name", "color", "category_ids"],
  transactions: ["account_id", "date", "amount_minor", "category_id", "payee", "notes", "tag_ids", "pending", "transfer_id",
    "entered_amount_minor", "entered_currency", "exchange_rate", "recurring_id", "lat", "lon", "place", "photo", "source"],
  recurring_rules: ["account_id", "amount_minor", "category_id", "payee", "notes", "tag_ids", "frequency", "interval",
    "start_date", "end_date", "next_date", "notify", "notify_days_before", "auto_post", "active", "time_of_day"],
  budgets: ["category_id", "currency", "amount_minor", "period", "starts", "start_day", "account_id", "tag_id", "ends", "ended"],
  insights: ["kind", "params", "sort"],
  debts: ["person", "direction", "amount_minor", "currency", "account_id", "opened_date", "due_date", "notes", "settled_date", "notify", "notify_time", "transaction_id"],
};

export function isSyncedTable(t: string): t is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(t);
}

/**
 * Raw upsert used by both local writes and backup import. Does NOT touch
 * the outbox or updated_at; callers decide that.
 */
export function upsertRaw<T extends SyncedTable>(db: SqlDriver, table: T, row: RowByTable[T]): void {
  const r = row as unknown as Record<string, SqlParam | undefined>;
  // Columns absent from the incoming row (older peer, newer schema) are left to their DEFAULTs.
  const cols = ["id", "updated_at", "deleted", ...TABLE_COLUMNS[table].filter((c) => r[c] !== undefined)];
  const values = cols.map((c) => r[c]!);
  const sets = cols.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(", ");
  db.run(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
     ON CONFLICT(id) DO UPDATE SET ${sets}`,
    values,
  );
}

export function getRow<T extends SyncedTable>(db: SqlDriver, table: T, id: string): RowByTable[T] | undefined {
  return db.get(`SELECT * FROM ${table} WHERE id=?`, [id]) as unknown as RowByTable[T] | undefined;
}

export function listRows<T extends SyncedTable>(db: SqlDriver, table: T, where = "deleted=0", params: SqlParam[] = [], orderBy = "rowid"): RowByTable[T][] {
  return db.all(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy}`, params) as unknown as RowByTable[T][];
}

/** Local write: stamps updated_at, upserts, and records the row as changed. */
export function save<T extends SyncedTable>(db: SqlDriver, table: T, input: Omit<RowByTable[T], keyof Synced> & Partial<Synced>): RowByTable[T] {
  const row = { ...input, id: input.id ?? newId(), updated_at: nowMs(), deleted: input.deleted ?? 0 } as RowByTable[T];
  db.transaction(() => {
    upsertRaw(db, table, row);
    db.run(`INSERT OR IGNORE INTO sync_outbox(tbl, id) VALUES (?, ?)`, [table, row.id]);
  });
  return row;
}

/** Soft delete (tombstone) so the deletion propagates through a backup merge. */
export function remove(db: SqlDriver, table: SyncedTable, id: string): void {
  db.transaction(() => {
    db.run(`UPDATE ${table} SET deleted=1, updated_at=? WHERE id=?`, [nowMs(), id]);
    db.run(`INSERT OR IGNORE INTO sync_outbox(tbl, id) VALUES (?, ?)`, [table, id]);
  });
}

/**
 * Delete every record. With `everywhere` the rows become tombstones, so the deletion travels the
 * next time a backup merges elsewhere; otherwise they are dropped outright together with the
 * change-tracking tables, leaving this database as if freshly installed.
 * Preferences stay, except the ones that point at accounts.
 */
export function eraseAll(db: SqlDriver, opts: { everywhere: boolean }): void {
  db.transaction(() => {
    for (const t of SYNCED_TABLES) {
      if (opts.everywhere) {
        db.run(`UPDATE ${t} SET deleted=1, updated_at=? WHERE deleted=0`, [nowMs()]);
        db.run(`INSERT OR IGNORE INTO sync_outbox(tbl, id) SELECT ?, id FROM ${t}`, [t]);
      } else db.run(`DELETE FROM ${t}`);
    }
    if (!opts.everywhere) { db.run(`DELETE FROM sync_outbox`); db.run(`DELETE FROM change_log`); db.run(`DELETE FROM meta WHERE key='last_pulled_seq'`); }
    db.run(`DELETE FROM meta WHERE key IN ('budget_scope', 'current_account', 'onboarded')`);
  });
}

// ---- Convenience creators with defaults --------------------------------------------------------

export function createAccount(db: SqlDriver, a: Partial<Account> & Pick<Account, "name" | "currency">): Account {
  return save(db, "accounts", {
    type: "bank", icon: null, color: null, sort: 0, archived: 0, include_in_net_worth: 1, opening_balance_minor: 0, ...a,
    // An account with no group is a stray everywhere it is listed, so an empty one (a CSV import
    // without a Budget Book column, a sheet the user never opened the group picker in) lands here.
    group_name: a.group_name?.trim() || DEFAULT_ACCOUNT_GROUP,
  } as Account);
}

export function createCategory(db: SqlDriver, c: Partial<Category> & Pick<Category, "name">): Category {
  return save(db, "categories", { parent_id: null, icon: null, color: null, sort: 0, kind: "expense", description: null, ...c } as Category);
}

export function createTag(db: SqlDriver, t: Partial<Tag> & Pick<Tag, "name">): Tag {
  return save(db, "tags", { color: null, category_ids: "[]", ...t } as Tag);
}

export function createTransaction(db: SqlDriver, t: Partial<Transaction> & Pick<Transaction, "account_id" | "date" | "amount_minor">): Transaction {
  return save(db, "transactions", {
    category_id: null, payee: null, notes: null, tag_ids: "[]", pending: 0, transfer_id: null,
    entered_amount_minor: null, entered_currency: null, exchange_rate: null, recurring_id: null, lat: null, lon: null, place: null, photo: null,
    source: null, ...t,
  } as Transaction);
}

export function createRecurring(db: SqlDriver, r: Partial<RecurringRule> & Pick<RecurringRule, "account_id" | "amount_minor" | "frequency" | "start_date">): RecurringRule {
  return save(db, "recurring_rules", {
    category_id: null, payee: null, notes: null, tag_ids: "[]", interval: 1, end_date: null,
    next_date: r.start_date, notify: 1, notify_days_before: 1, auto_post: 0, active: 1, time_of_day: "09:00", ...r,
  } as RecurringRule);
}

export function createBudget(db: SqlDriver, b: Partial<Budget> & Pick<Budget, "currency" | "amount_minor" | "starts">): Budget {
  return save(db, "budgets", { category_id: null, tag_id: null, period: "monthly", start_day: 1, account_id: null, ends: null, ended: null, ...b } as Budget);
}

export function createInsight(db: SqlDriver, i: Partial<Insight> & Pick<Insight, "kind">): Insight {
  return save(db, "insights", { params: "{}", sort: 0, ...i } as Insight);
}

export function createDebt(db: SqlDriver, d: Partial<Debt> & Pick<Debt, "person" | "amount_minor" | "currency" | "opened_date">): Debt {
  return save(db, "debts", { direction: "owed_to_me", account_id: null, due_date: null, notes: null, settled_date: null, notify: 1, notify_time: DEFAULT_DEBT_NOTIFY_TIME, transaction_id: null, ...d } as Debt);
}

/**
 * Create both legs of a transfer atomically. `fromAmountMinor` is positive, in the
 * source account currency; `toAmountMinor` in the destination currency.
 */
export function createTransfer(db: SqlDriver, p: {
  from_account_id: string; to_account_id: string; date: string;
  from_amount_minor: number; to_amount_minor: number;
  from_currency: string; to_currency: string;
  category_id?: string | null; tag_ids?: string; notes?: string | null; pending?: 0 | 1;
}): { out: Transaction; in: Transaction; transfer_id: string } {
  const transfer_id = newId();
  const cross = p.from_currency !== p.to_currency;
  // rate = destination units per 1 source unit
  const rate = cross ? (p.to_amount_minor / p.from_amount_minor) : null;
  return db.transaction(() => {
    const out = createTransaction(db, {
      account_id: p.from_account_id, date: p.date, amount_minor: -p.from_amount_minor, transfer_id,
      category_id: p.category_id ?? null, tag_ids: p.tag_ids ?? "[]", notes: p.notes ?? null, pending: p.pending ?? 0,
      entered_amount_minor: cross ? p.to_amount_minor : null, entered_currency: cross ? p.to_currency : null,
      exchange_rate: rate,
    });
    const inn = createTransaction(db, {
      account_id: p.to_account_id, date: p.date, amount_minor: p.to_amount_minor, transfer_id,
      category_id: p.category_id ?? null, tag_ids: p.tag_ids ?? "[]", notes: p.notes ?? null, pending: p.pending ?? 0,
      entered_amount_minor: cross ? p.from_amount_minor : null, entered_currency: cross ? p.from_currency : null,
      exchange_rate: cross ? 1 / rate! : null,
    });
    return { out, in: inn, transfer_id };
  });
}

// ---- Queries -----------------------------------------------------------------------------------

/** Balance as of now. Future-dated (planned) transactions are excluded unless `includeFuture` is set. */
export function accountBalanceMinor(db: SqlDriver, accountId: string, opts: { includePending?: boolean; upTo?: string; includeFuture?: boolean; now?: string } = {}): number {
  const conds = ["account_id=?", "deleted=0"];
  const params: SqlParam[] = [accountId];
  if (!opts.includePending) conds.push("pending=0");
  if (opts.upTo) { conds.push("date<=?"); params.push(opts.upTo); }
  else if (!opts.includeFuture) { conds.push("date<=?"); params.push(opts.now ?? localNowIso()); }
  const r = db.get<{ s: number | null }>(`SELECT SUM(amount_minor) AS s FROM transactions WHERE ${conds.join(" AND ")}`, params);
  const opening = db.get<{ o: number }>(`SELECT opening_balance_minor AS o FROM accounts WHERE id=?`, [accountId])?.o ?? 0;
  return opening + (r?.s ?? 0);
}

/**
 * Which of these categories are folders: the ones another (live) category names as its parent.
 *
 * A folder groups the list, it is not a place to file money, so nothing may be assigned to one —
 * the pickers, the intents and the receipt reader all filter through this. Being a folder is
 * therefore about having categories inside, not about sitting at the top level: a top-level
 * category with nothing in it is an ordinary category and stays pickable, so a database whose
 * categories are all flat is never left with nothing to choose.
 */
export function folderIds(cats: { id: string; parent_id: string | null }[]): Set<string> {
  return new Set(cats.flatMap((c) => (c.parent_id ? [c.parent_id] : [])));
}

export interface CategorySpend { category_id: string | null; currency: string; spent_minor: number }

/** Spend per category per currency between two ISO dates (inclusive start, exclusive end). Transfers excluded; optionally limited to some accounts. */
export function categorySpend(db: SqlDriver, fromIso: string, toIso: string, accountIds?: string[]): CategorySpend[] {
  const scope = accountIds?.length ? ` AND t.account_id IN (${accountIds.map(() => "?").join(",")})` : "";
  return db.all<Row>(
    `SELECT t.category_id, a.currency, SUM(t.amount_minor) AS spent_minor
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.date>=? AND t.date<? AND t.amount_minor<0${scope}
     GROUP BY t.category_id, a.currency`,
    [fromIso, toIso, ...(accountIds?.length ? accountIds : [])],
  ) as unknown as CategorySpend[];
}

export interface RecurringSpend { recurring_id: string; currency: string; spent_minor: number; n: number }

/**
 * What the recurring rules actually cost over a window, per rule and currency. Only rows a rule
 * posted (`recurring_id`) count, so a payment you logged by hand does not show up here twice.
 * Transfers are excluded like everywhere else; income keeps its sign so a salary rule nets off.
 */
export function recurringSpend(db: SqlDriver, fromIso: string, toIso: string, accountIds?: string[]): RecurringSpend[] {
  const scope = accountIds?.length ? ` AND t.account_id IN (${accountIds.map(() => "?").join(",")})` : "";
  return db.all<Row>(
    `SELECT t.recurring_id, a.currency, SUM(t.amount_minor) AS spent_minor, COUNT(*) AS n
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     WHERE t.deleted=0 AND t.transfer_id IS NULL AND t.recurring_id IS NOT NULL AND t.date>=? AND t.date<?${scope}
     GROUP BY t.recurring_id, a.currency`,
    [fromIso, toIso, ...(accountIds?.length ? accountIds : [])],
  ) as unknown as RecurringSpend[];
}

export interface TagSpend { category_id: string | null; currency: string; spent_minor: number }

/**
 * Expenses carrying a tag, per category and currency. Transfers excluded; optionally limited to
 * some accounts and to a date window (inclusive start, exclusive end). Without dates: all time.
 */
export function tagSpend(db: SqlDriver, tagId: string, o: { fromIso?: string; toIso?: string; accountIds?: string[] } = {}): TagSpend[] {
  const conds = ["t.deleted=0", "t.transfer_id IS NULL", "t.amount_minor<0", "t.tag_ids LIKE ?"];
  const params: SqlParam[] = [`%"${tagId}"%`];
  if (o.fromIso) { conds.push("t.date>=?"); params.push(o.fromIso); }
  if (o.toIso) { conds.push("t.date<?"); params.push(o.toIso); }
  if (o.accountIds?.length) { conds.push(`t.account_id IN (${o.accountIds.map(() => "?").join(",")})`); params.push(...o.accountIds); }
  return db.all<Row>(
    `SELECT t.category_id, a.currency, SUM(t.amount_minor) AS spent_minor
     FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE ${conds.join(" AND ")}
     GROUP BY t.category_id, a.currency`, params) as unknown as TagSpend[];
}

/** Local-time ISO with offset, comparable with stored transaction dates. */
export function localNowIso(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? "+" : "-"; const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function tagIdsOf(t: { tag_ids: string }): string[] {
  return jsonIds(t.tag_ids);
}

/** Parse a JSON array-of-strings column defensively. */
export function jsonIds(raw: string | null | undefined): string[] {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

/**
 * Tags that make sense for a category: unrestricted tags plus the ones assigned to the
 * category or its folder. Tags for other categories are left out. With no category, every tag.
 */
export function tagsForCategory(db: SqlDriver, categoryId: string | null): Tag[] {
  const tags = listRows(db, "tags", "deleted=0", [], "name");
  if (!categoryId) return tags;
  const cat = getRow(db, "categories", categoryId);
  const scope = new Set([categoryId, cat?.parent_id ?? ""]);
  return tags.filter((t) => { const ids = jsonIds(t.category_ids); return ids.length === 0 || ids.some((id) => scope.has(id)); });
}

/** Rough great-circle distance in metres; good enough for "same shop". */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export interface PlaceSuggestion { category_id: string; count: number; place: string | null }

/** The user's home (Settings → Remember location → Home): no category is suggested within `HOME_RADIUS_M` of it. */
export function getHome(db: SqlDriver): { lat: number; lon: number; place: string | null } | null {
  const lat = Number(getMeta(db, "home_lat")), lon = Number(getMeta(db, "home_lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || getMeta(db, "home_lat") === null) return null;
  return { lat, lon, place: getMeta(db, "home_place") };
}
export function setHome(db: SqlDriver, home: { lat: number; lon: number; place: string | null } | null): void {
  if (!home) { db.run(`DELETE FROM meta WHERE key IN ('home_lat','home_lon','home_place')`); return; }
  setMeta(db, "home_lat", String(home.lat)); setMeta(db, "home_lon", String(home.lon));
  if (home.place) setMeta(db, "home_place", home.place); else db.run(`DELETE FROM meta WHERE key='home_place'`);
}

/**
 * Most common category among earlier transactions logged within `radiusM` of a point.
 * Cheap: a bounding-box query on the indexed columns, then an exact distance check.
 */
/** No category is suggested this close to home (anything gets bought there). */
export const HOME_RADIUS_M = 50;

export function suggestCategoryNear(db: SqlDriver, lat: number, lon: number, radiusM = 150): PlaceSuggestion | null {
  // At home anything gets bought, so no category is suggested there (meta `home_lat`/`home_lon`, set in Settings).
  const home = getHome(db);
  if (home && distanceMeters(lat, lon, home.lat, home.lon) <= HOME_RADIUS_M) return null;
  const dLat = radiusM / 111_000, dLon = radiusM / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const rows = db.all<{ category_id: string; lat: number; lon: number; place: string | null }>(
    `SELECT category_id, lat, lon, place FROM transactions WHERE deleted=0 AND transfer_id IS NULL AND category_id IS NOT NULL
     AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY date DESC LIMIT 200`,
    [lat - dLat, lat + dLat, lon - dLon, lon + dLon]);
  const counts = new Map<string, PlaceSuggestion>();
  for (const r of rows) {
    if (distanceMeters(lat, lon, r.lat, r.lon) > radiusM) continue;
    const e = counts.get(r.category_id) ?? { category_id: r.category_id, count: 0, place: null };
    e.count++; e.place ??= r.place; counts.set(r.category_id, e);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0] ?? null;
}

/**
 * Turn a tag into a category: every transaction (and rule) carrying the tag gets the new
 * category and loses the tag; the tag is deleted. Returns the new category.
 */
export function convertTagToCategory(db: SqlDriver, tagId: string, o: { parent_id: string | null; kind?: "expense" | "income"; replaceCategory?: boolean }): Category {
  const tag = getRow(db, "tags", tagId);
  if (!tag) throw new Error("Tag not found");
  return db.transaction(() => {
    const cat = createCategory(db, { name: tag.name, parent_id: o.parent_id, kind: o.kind ?? "expense", color: tag.color });
    const needle = `%"${tagId}"%`;
    for (const t of listRows(db, "transactions", "deleted=0 AND tag_ids LIKE ?", [needle])) {
      const ids = tagIdsOf(t).filter((id) => id !== tagId);
      save(db, "transactions", { ...t, tag_ids: JSON.stringify(ids), category_id: o.replaceCategory === false && t.category_id ? t.category_id : cat.id });
    }
    for (const r of listRows(db, "recurring_rules", "deleted=0 AND tag_ids LIKE ?", [needle])) {
      const ids = jsonIds(r.tag_ids).filter((id) => id !== tagId);
      save(db, "recurring_rules", { ...r, tag_ids: JSON.stringify(ids), category_id: o.replaceCategory === false && r.category_id ? r.category_id : cat.id });
    }
    remove(db, "tags", tagId);
    return cat;
  });
}
