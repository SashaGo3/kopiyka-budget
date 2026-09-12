import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { MIGRATIONS, migrate } from "../src/schema";
import { DEFAULT_ACCOUNT_GROUP } from "../src/models";
import { createAccount, listRows } from "../src/repo";

describe("migrate", () => {
  test("re-running a version whose columns already exist does not throw", () => {
    const db = openBunDb(":memory:");
    migrate(db);
    // Pretend the recorded version fell behind the real schema (columns of v5 present, version says 4).
    db.run(`UPDATE meta SET value='4' WHERE key='schema_version'`);
    expect(() => migrate(db)).not.toThrow();
    expect(db.get<{ value: string }>(`SELECT value FROM meta WHERE key='schema_version'`)?.value).toBe(String(MIGRATIONS.length));
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pragma_table_info('budgets') WHERE name='tag_id'`)?.n).toBe(1);
  });

  test("v9 moves groupless accounts into the default group and leaves the others alone", () => {
    const db = openBunDb(":memory:");
    migrate(db);
    db.run(`INSERT INTO accounts (id, updated_at, deleted, name, currency, type, group_name) VALUES
      ('a1', 1, 0, 'Wallet', 'PLN', 'cash', ''), ('a2', 1, 0, 'Firma', 'PLN', 'bank', 'Business')`);
    db.run(`UPDATE meta SET value='8' WHERE key='schema_version'`);
    migrate(db);
    const byId = new Map(listRows(db, "accounts").map((a) => [a.id, a]));
    expect(byId.get("a1")?.group_name).toBe(DEFAULT_ACCOUNT_GROUP);
    expect(byId.get("a1")?.updated_at).toBeGreaterThan(1);
    expect(byId.get("a2")?.group_name).toBe("Business");
    expect(byId.get("a2")?.updated_at).toBe(1);
  });

  test("a new account is never groupless", () => {
    const db = openBunDb(":memory:");
    migrate(db);
    expect(createAccount(db, { name: "Wallet", currency: "PLN" }).group_name).toBe(DEFAULT_ACCOUNT_GROUP);
    expect(createAccount(db, { name: "Blank", currency: "PLN", group_name: "  " }).group_name).toBe(DEFAULT_ACCOUNT_GROUP);
    expect(createAccount(db, { name: "Firma", currency: "PLN", group_name: "Business" }).group_name).toBe("Business");
  });
});
