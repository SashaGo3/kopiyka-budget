import { expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createRecurring, getRow } from "../src/repo";
import { exportBackup, importBackup } from "../src/backup";

test("a backup from before v21 leaves a rule's chosen icon alone, and a newer one carries it", () => {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "A", currency: "PLN" });
  const rule = createRecurring(db, { account_id: acc.id, amount_minor: -4999, frequency: "monthly", start_date: "2026-10-01", payee: "Netflix", icon: "emoji:🎬" });
  const file = exportBackup(db);
  const rows = (file as unknown as { recurring_rules: Record<string, unknown>[] }).recurring_rules;
  const old = rows.map((r) => { const { icon: _drop, ...rest } = r; return { ...rest, updated_at: Date.now() + 60_000, payee: "Netflix HD" }; });
  importBackup(db, { ...file, recurring_rules: old } as typeof file);
  expect(getRow(db, "recurring_rules", rule.id)).toMatchObject({ payee: "Netflix HD", icon: "emoji:🎬" });

  const other = openBunDb(); migrate(other);
  importBackup(other, exportBackup(db));
  expect(getRow(other, "recurring_rules", rule.id)?.icon).toBe("emoji:🎬");
});
