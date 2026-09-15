import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate, getMeta, setMeta } from "../src/schema";
import { cachedRate } from "../src/rates";
import { createAccount, createCategory, createTag, createTransaction, createRecurring, createBudget, listRows, getRow, remove, tagsForCategory, suggestCategoryNear, getHome, setHome } from "../src/repo";
import { BACKUP_META_KEYS, exportBackup, exportBackupJson, importBackup } from "../src/backup";

function fresh() { const db = openBunDb(); migrate(db); return db; }

describe("backup", () => {
  // A preference the app writes but this list does not name is silently lost on restore. Pinning the
  // list means adding one is a deliberate line in a diff rather than something nobody notices until
  // a phone comes back from a backup with its settings quietly reset.
  test("carries every preference the app stores, and no identity of the device it came from", () => {
    expect([...BACKUP_META_KEYS].sort()).toEqual([
      "backup_per_day", "base_currency", "budget_scope", "current_account",
      "hide_income", "home_lat", "home_lon", "home_place", "language", "location_enabled",
      "period_start_day", "recurring_notify_days_before", "shortcut_notify", "show_balance",
    ]);
    // These describe the install, not the data, and must never travel with a backup.
    for (const k of ["device_id", "last_pulled_seq", "onboarded"]) expect(BACKUP_META_KEYS as readonly string[]).not.toContain(k);
  });

  test("replace makes the file the whole truth: removed categories go, edits win, rates stay", () => {
    const a = fresh();
    const acc = createAccount(a, { name: "Cash", currency: "PLN" });
    const keep = createCategory(a, { name: "Food" });
    const drop = createCategory(a, { name: "Miscellaneous" });
    createTransaction(a, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, category_id: keep.id });
    a.run(`INSERT INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["EUR", "PLN", "2021-03-17", 4.5, 1000]);

    // What a restructuring pass hands back: one category renamed, the other gone, no rates at all.
    const edited = exportBackup(a);
    edited.categories = edited.categories.filter((c) => c.id !== drop.id).map((c) => ({ ...c, name: "Groceries", updated_at: 1 }));
    delete edited.rates;

    const report = importBackup(a, edited, { mode: "replace" });
    expect(report.removed).toBe(1);
    expect(getRow(a, "categories", drop.id)).toBeUndefined();
    // The file's row is older than the phone's and still wins — that is what replace means.
    expect(getRow(a, "categories", keep.id)?.name).toBe("Groceries");
    // The transaction it belongs to is untouched, and the rate history a rewrite knows nothing about stays.
    expect(listRows(a, "transactions", "deleted=0").length).toBe(1);
    expect(cachedRate(a, "EUR", "PLN", "2021-03-17")).toBe(4.5);
  });

  test("merge never deletes, so the same edited file leaves the old category behind", () => {
    const a = fresh();
    const drop = createCategory(a, { name: "Miscellaneous" });
    createCategory(a, { name: "Food" });
    const edited = exportBackup(a);
    edited.categories = edited.categories.filter((c) => c.id !== drop.id);
    const report = importBackup(a, edited);
    expect(report.removed).toBe(0);
    expect(getRow(a, "categories", drop.id)?.name).toBe("Miscellaneous");
  });

  test("replacing with a backup of the old data puts everything back", () => {
    const a = fresh();
    const acc = createAccount(a, { name: "Cash", currency: "PLN" });
    const cat = createCategory(a, { name: "Food" });
    createTransaction(a, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, category_id: cat.id });
    const before = exportBackupJson(a);   // the safety copy taken before a replace

    const wrecked = exportBackup(a);
    wrecked.categories = [];
    wrecked.transactions = [];
    importBackup(a, wrecked, { mode: "replace" });
    expect(listRows(a, "transactions", "deleted=0").length).toBe(0);

    // Going back is the same operation, pointed at the copy taken first.
    const back = importBackup(a, before, { mode: "replace" });
    expect(back.imported.transactions).toBe(1);
    expect(getRow(a, "categories", cat.id)?.name).toBe("Food");
    expect(listRows(a, "transactions", "deleted=0").length).toBe(1);
  });

  test("the rate a 2021 transfer used survives a restore, and a newer one is not overwritten", () => {
    const a = fresh();
    a.run(`INSERT INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["EUR", "PLN", "2021-03-17", 4.5, 1000]);
    a.run(`INSERT INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["EUR", "PLN", "2026-09-12", 4.3, 1000]);
    const b = fresh();
    // This phone already knows a better answer for today; the backup must not undo it.
    b.run(`INSERT INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["EUR", "PLN", "2026-09-12", 4.31, 2000]);
    const report = importBackup(b, exportBackupJson(a));
    expect(report.rates).toBe(1);
    expect(cachedRate(b, "EUR", "PLN", "2021-03-17")).toBe(4.5);   // the old day came across
    expect(cachedRate(b, "EUR", "PLN", "2026-09-12")).toBe(4.31);  // the newer local one stood
    // The inverse direction still resolves, which is what conversions actually ask for.
    expect(cachedRate(b, "PLN", "EUR", "2021-03-17")).toBeCloseTo(1 / 4.5, 10);
  });

  test("a restored phone keeps its home, its hidden income and its balance preference", () => {
    const a = fresh();
    setHome(a, { lat: 52.23, lon: 21.01, place: "Home" });
    setMeta(a, "hide_income", "1");
    setMeta(a, "show_balance", "1");
    setMeta(a, "backup_per_day", "3");
    const b = fresh();
    importBackup(b, exportBackupJson(a));
    expect(getHome(b)).toEqual({ lat: 52.23, lon: 21.01, place: "Home" });
    expect(getMeta(b, "hide_income")).toBe("1");
    expect(getMeta(b, "show_balance")).toBe("1");
    expect(getMeta(b, "backup_per_day")).toBe("3");
  });

  test("round-trips every table, ids and settings", () => {
    const a = fresh();
    const acc = createAccount(a, { name: "Cash", currency: "PLN", icon: "banknote", color: "#fff" });
    const folder = createCategory(a, { name: "Food", icon: "cart.fill", color: "#FF9F0A" });
    const cat = createCategory(a, { name: "Coffee", parent_id: folder.id, icon: "cup.and.saucer.fill" });
    const tag = createTag(a, { name: "work", category_ids: JSON.stringify([folder.id]) });
    createTransaction(a, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -1250, category_id: cat.id, tag_ids: JSON.stringify([tag.id]), lat: 52.23, lon: 21.01, place: "Cafe" });
    createRecurring(a, { account_id: acc.id, amount_minor: -6000, frequency: "monthly", start_date: "2026-09-10", payee: "Netflix" });
    createBudget(a, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_id: folder.id });
    setMeta(a, "period_start_day", "15");
    setMeta(a, "base_currency", "PLN");
    setMeta(a, "current_account", acc.id);
    const deleted = createCategory(a, { name: "Gone" }); remove(a, "categories", deleted.id);

    const json = exportBackupJson(a);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("kopiyka-backup");
    expect(parsed.categories.map((c: { name: string }) => c.name).sort()).toEqual(["Coffee", "Food"]);
    expect(parsed.transactions[0].lat).toBe(52.23);
    expect(parsed.recurring_rules[0].notify_days_before).toBe(1);
    expect(parsed.settings.period_start_day).toBe("15");
    expect(parsed.settings.base_currency).toBe("PLN");
    expect(parsed.settings.current_account).toBe(acc.id);

    const b = fresh();
    const report = importBackup(b, json);
    expect(report.imported).toEqual({ accounts: 1, categories: 2, tags: 1, transactions: 1, recurring_rules: 1, budgets: 1, insights: 0, debts: 0 });
    expect(getRow(b, "categories", cat.id)?.icon).toBe("cup.and.saucer.fill");
    expect(getRow(b, "tags", tag.id)?.category_ids).toBe(JSON.stringify([folder.id]));
    expect(getMeta(b, "period_start_day")).toBe("15");
    expect(getMeta(b, "base_currency")).toBe("PLN");
    expect(getMeta(b, "current_account")).toBe(acc.id);
    expect(b.all(`SELECT * FROM sync_outbox`).length).toBe(7);
    // Importing again changes nothing.
    expect(importBackup(b, json).skipped).toBe(7);
    expect(exportBackup(b).transactions.length).toBe(1);
  });
  test("rejects foreign files", () => {
    expect(() => importBackup(fresh(), '{"hello":1}')).toThrow();
  });
});

describe("compact backup", () => {
  test("round-trips: a compact export imports into an empty db to the same rows", () => {
    const a = fresh();
    const acc = createAccount(a, { name: "Cash", currency: "PLN" }); // icon/color left null
    const folder = createCategory(a, { name: "Food", icon: "cart.fill", color: "#FF9F0A" });
    const cat = createCategory(a, { name: "Coffee", parent_id: folder.id }); // icon/color/description null
    const tag = createTag(a, { name: "work" });
    const tx = createTransaction(a, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -1250, category_id: cat.id, notes: "latte" });
    const rec = createRecurring(a, { account_id: acc.id, amount_minor: -6000, frequency: "monthly", start_date: "2026-09-10" });
    const bud = createBudget(a, { currency: "PLN", amount_minor: 100000, starts: "2026-09-01", category_id: folder.id });

    const backup = exportBackup(a, { includeDeleted: true, compact: true, now: () => new Date("2026-09-08T00:00:00Z") });
    const accRow = backup.accounts.find((r) => r.id === acc.id) as unknown as Record<string, unknown>;
    expect("icon" in accRow).toBe(false);
    expect("color" in accRow).toBe(false);

    const b = fresh();
    importBackup(b, backup);
    for (const [table, id] of [["accounts", acc.id], ["categories", folder.id], ["categories", cat.id], ["tags", tag.id],
      ["transactions", tx.id], ["recurring_rules", rec.id], ["budgets", bud.id]] as const) {
      expect(getRow(b, table, id)).toEqual(getRow(a, table, id));
    }
  });

  test("tombstones older than 30 days shrink to id/updated_at/deleted", () => {
    const a = fresh();
    const cat = createCategory(a, { name: "Gone", icon: "trash" });
    remove(a, "categories", cat.id);
    a.run(`UPDATE categories SET updated_at=? WHERE id=?`, [Date.parse("2026-01-01T00:00:00Z"), cat.id]);
    const backup = exportBackup(a, { includeDeleted: true, compact: true, now: () => new Date("2026-09-08T00:00:00Z") });
    const row = backup.categories.find((c) => c.id === cat.id) as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["deleted", "id", "updated_at"]);
    expect(row.deleted).toBe(1);

    // Imports cleanly into an empty db and stays a tombstone (not shown among active rows).
    const b = fresh();
    const report = importBackup(b, backup);
    expect(report.imported.categories).toBe(1);
    expect(getRow(b, "categories", cat.id)?.deleted).toBe(1);
    expect(listRows(b, "categories").length).toBe(0);
  });

  test("recent tombstones keep their non-null fields", () => {
    const a = fresh();
    const cat = createCategory(a, { name: "Gone", icon: "trash" });
    remove(a, "categories", cat.id);
    const backup = exportBackup(a, { includeDeleted: true, compact: true, now: () => new Date() });
    const row = backup.categories.find((c) => c.id === cat.id) as unknown as Record<string, unknown>;
    expect(row.name).toBe("Gone");
    expect(row.icon).toBe("trash");
    expect("color" in row).toBe(false); // null, dropped like any compact row
  });
});

describe("tags per category and place suggestions", () => {
  test("tags limited to categories are offered only there", () => {
    const db = fresh();
    const food = createCategory(db, { name: "Food" });
    const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
    const car = createCategory(db, { name: "Car" });
    createTag(db, { name: "any" });
    createTag(db, { name: "latte", category_ids: JSON.stringify([food.id]) });
    createTag(db, { name: "fuel", category_ids: JSON.stringify([car.id]) });
    expect(tagsForCategory(db, coffee.id).map((t) => t.name)).toEqual(["any", "latte"]);
    expect(tagsForCategory(db, car.id).map((t) => t.name)).toEqual(["any", "fuel"]);
    expect(tagsForCategory(db, null).map((t) => t.name)).toEqual(["any", "fuel", "latte"]);
  });
  test("suggests the most used category near a point", () => {
    const db = fresh();
    const acc = createAccount(db, { name: "A", currency: "PLN" });
    const coffee = createCategory(db, { name: "Coffee" }), food = createCategory(db, { name: "Food" });
    for (let i = 0; i < 3; i++) createTransaction(db, { account_id: acc.id, date: `2026-09-0${i + 1}T10:00:00+02:00`, amount_minor: -1000, category_id: coffee.id, lat: 52.2297 + i * 0.0001, lon: 21.0122, place: "Cafe" });
    createTransaction(db, { account_id: acc.id, date: "2026-09-05T10:00:00+02:00", amount_minor: -1000, category_id: food.id, lat: 52.2297, lon: 21.0122 });
    createTransaction(db, { account_id: acc.id, date: "2026-09-06T10:00:00+02:00", amount_minor: -1000, category_id: food.id, lat: 52.3, lon: 21.1 });
    expect(suggestCategoryNear(db, 52.2298, 21.0123)).toEqual({ category_id: coffee.id, count: 3, place: "Cafe" });
    expect(suggestCategoryNear(db, 50, 20)).toBeNull();
    expect(listRows(db, "transactions").length).toBe(5);
    // At home nothing is suggested; clearing home brings the suggestion back.
    setHome(db, { lat: 52.2297, lon: 21.0122, place: "Home" });
    expect(getHome(db)).toEqual({ lat: 52.2297, lon: 21.0122, place: "Home" });
    expect(suggestCategoryNear(db, 52.2298, 21.0123)).toBeNull();
    // 50 m is the edge: ~120 m away the suggestion is back even with home set.
    expect(suggestCategoryNear(db, 52.2308, 21.0123)?.category_id).toBe(coffee.id);
    setHome(db, null);
    expect(getHome(db)).toBeNull();
    expect(suggestCategoryNear(db, 52.2298, 21.0123)?.category_id).toBe(coffee.id);
  });
});
