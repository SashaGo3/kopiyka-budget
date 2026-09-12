import type { SqlDriver } from "./db";

const SYNC_COLS = `id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0`;

/** Ordered migrations. Never edit a shipped entry; append a new one. */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS accounts (${SYNC_COLS},
      name TEXT NOT NULL, currency TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'bank',
      group_name TEXT NOT NULL DEFAULT '', icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, include_in_net_worth INTEGER NOT NULL DEFAULT 1,
      opening_balance_minor INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS categories (${SYNC_COLS},
      name TEXT NOT NULL, parent_id TEXT, icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'expense')`,
    `CREATE TABLE IF NOT EXISTS tags (${SYNC_COLS}, name TEXT NOT NULL, color TEXT)`,
    `CREATE TABLE IF NOT EXISTS transactions (${SYNC_COLS},
      account_id TEXT NOT NULL, date TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      category_id TEXT, payee TEXT, notes TEXT, tag_ids TEXT NOT NULL DEFAULT '[]',
      pending INTEGER NOT NULL DEFAULT 0, transfer_id TEXT,
      entered_amount_minor INTEGER, entered_currency TEXT, exchange_rate REAL, recurring_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(transfer_id)`,
    `CREATE TABLE IF NOT EXISTS recurring_rules (${SYNC_COLS},
      account_id TEXT NOT NULL, amount_minor INTEGER NOT NULL, category_id TEXT, payee TEXT, notes TEXT,
      tag_ids TEXT NOT NULL DEFAULT '[]', frequency TEXT NOT NULL, interval INTEGER NOT NULL DEFAULT 1,
      start_date TEXT NOT NULL, end_date TEXT, next_date TEXT NOT NULL,
      notify INTEGER NOT NULL DEFAULT 1, notify_days_before INTEGER NOT NULL DEFAULT 0,
      auto_post INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS budgets (${SYNC_COLS},
      category_id TEXT, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly', starts TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sync_outbox (tbl TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (tbl, id))`,
    `CREATE TABLE IF NOT EXISTS change_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL,
      id TEXT NOT NULL, updated_at INTEGER NOT NULL, device_id TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_change_log_tbl_id ON change_log(tbl, id)`,
    `CREATE TABLE IF NOT EXISTS exchange_rates (base TEXT NOT NULL, quote TEXT NOT NULL, day TEXT NOT NULL,
      rate REAL NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (base, quote, day))`,
  ],
  [
    // v2: recurring rules keep a time of day, budgets can start mid-month (salary day).
    `ALTER TABLE recurring_rules ADD COLUMN time_of_day TEXT NOT NULL DEFAULT '09:00'`,
    `ALTER TABLE budgets ADD COLUMN start_day INTEGER NOT NULL DEFAULT 1`,
  ],
  [
    // v3: tags can be limited to categories; transactions remember where they were logged (coarse) so
    // the category can be suggested at the same place next time.
    `ALTER TABLE tags ADD COLUMN category_ids TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE transactions ADD COLUMN lat REAL`,
    `ALTER TABLE transactions ADD COLUMN lon REAL`,
    `ALTER TABLE transactions ADD COLUMN place TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_tx_geo ON transactions(lat, lon)`,
  ],
  [
    // v4: budgets can belong to one account (a "current account" keeps its own budgets);
    // insights are user-configured statistics cards.
    `ALTER TABLE budgets ADD COLUMN account_id TEXT`,
    `CREATE TABLE IF NOT EXISTS insights (${SYNC_COLS}, kind TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0)`,
  ],
  [
    // v5: budgets can be for a tag, and one-off (a trip: travel mode is a once-budget for a tag that has not ended).
    `ALTER TABLE budgets ADD COLUMN tag_id TEXT`,
    `ALTER TABLE budgets ADD COLUMN ends TEXT`,
    `ALTER TABLE budgets ADD COLUMN ended TEXT`,
  ],
  [
    // v6: categories carry a free-text description the receipt scanner uses to pick a category.
    `ALTER TABLE categories ADD COLUMN description TEXT`,
  ],
  [
    // v7: a transaction can carry one photo (file name in the app's photos directory; the file itself is not synced yet).
    `ALTER TABLE transactions ADD COLUMN photo TEXT`,
  ],
  [
    // v8: a transaction remembers where it came from (a Shortcut automation, a receipt scan, the
    // watch) so the app can say so and treat it differently; money lent and borrowed gets its own
    // table, with a due date the reminder is built from.
    `ALTER TABLE transactions ADD COLUMN source TEXT`,
    `CREATE TABLE IF NOT EXISTS debts (${SYNC_COLS},
      person TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'owed_to_me',
      amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, account_id TEXT,
      opened_date TEXT NOT NULL, due_date TEXT, notes TEXT, settled_date TEXT,
      notify INTEGER NOT NULL DEFAULT 1, transaction_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_debts_due ON debts(due_date)`,
  ],
  [
    // v9: every account belongs to a group, so the ones that named none join the default one
    // (`DEFAULT_ACCOUNT_GROUP`, spelled out here because a shipped migration must keep doing what
    // it did on the day it shipped, whatever that constant becomes later).
    `INSERT OR IGNORE INTO sync_outbox(tbl, id) SELECT 'accounts', id FROM accounts WHERE group_name=''`,
    `UPDATE accounts SET group_name='Personal', updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE group_name=''`,
  ],
  [
    // v10: a debt reminder fires at a time of day of its own, the way a recurring rule already did.
    // The default is spelled out here (and equals `DEFAULT_DEBT_NOTIFY_TIME`) because a shipped
    // migration must keep doing what it did on the day it shipped; debts written before this
    // fired at a hard-coded 09:00, and move to 08:00 with everything else.
    `ALTER TABLE debts ADD COLUMN notify_time TEXT NOT NULL DEFAULT '08:00'`,
  ],
];

const ADD_COLUMN = /^\s*ALTER TABLE (\w+) ADD COLUMN (\w+)/i;

/**
 * Column additions are skipped when the column is already there. A database can be ahead of its
 * recorded version (the native side or an interrupted run added the columns first); without this
 * the app would crash at launch with "duplicate column name".
 */
function hasColumn(db: SqlDriver, table: string, column: string): boolean {
  return !!db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name=?`, [table, column])?.n;
}

export function migrate(db: SqlDriver): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const cur = Number(db.get<{ value: string }>(`SELECT value FROM meta WHERE key='schema_version'`)?.value ?? 0);
  db.transaction(() => {
    for (let v = cur; v < MIGRATIONS.length; v++) {
      for (const stmt of MIGRATIONS[v]!) {
        const add = ADD_COLUMN.exec(stmt);
        if (add && hasColumn(db, add[1]!, add[2]!)) continue;
        db.run(stmt);
      }
    }
    db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)`, [String(MIGRATIONS.length)]);
  });
}

export function getMeta(db: SqlDriver, key: string): string | null {
  return db.get<{ value: string }>(`SELECT value FROM meta WHERE key=?`, [key])?.value ?? null;
}
export function setMeta(db: SqlDriver, key: string, value: string): void {
  db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)`, [key, value]);
}
