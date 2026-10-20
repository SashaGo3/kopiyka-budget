/**
 * Test data for the transfer flows (12–14), written through the core API (DATA.md rule 10 — never
 * the sqlite3 CLI) into a simulator's database while the app is not running.
 *
 *   bun apps/mobile/.maestro/seed/transfers.ts <udid>          # accounts + two unpaired bank legs
 *   bun apps/mobile/.maestro/seed/transfers.ts <udid> --clean  # tombstone everything it wrote
 *
 * Three accounts — "E2E PLN", "E2E PLN 2" and "E2E USD" — and the two halves of one transfer exactly
 * as the notification automation leaves them when the app is closed: a pending debit on E2E USD and
 * a pending credit on E2E PLN, each with the account numbers its bank printed (`bank_ref`) and not
 * yet paired. The app's launch sweep (core `pairTransferLegs`) is what turns them into the pending
 * transfer flow 14 approves. Fixed ids, so running it twice changes nothing and --clean finds it all.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAccount, createTransaction, getRow, listRows, migrate, remove, writeBankRef } from "@kopiyka/core";
import { openBunDb } from "@kopiyka/core/drivers/bun";

const BUNDLE_ID = "dev.kopiyka.app";
const [udid, flag] = process.argv.slice(2);
if (!udid) { console.error("usage: bun apps/mobile/.maestro/seed/transfers.ts <simulator udid> [--clean]"); process.exit(1); }

// The app must not have the file open (rule 10).
try { execFileSync("xcrun", ["simctl", "terminate", udid, BUNDLE_ID], { stdio: "ignore" }); } catch { /* not running: fine */ }
const out = execFileSync("xcrun", ["simctl", "get_app_container", udid, BUNDLE_ID, "groups"], { encoding: "utf8" });
const line = out.split("\n").map((l) => l.trim()).find((l) => l.includes("group.dev.kopiyka")) ?? out.trim();
const groupPath = (line.includes("\t") ? line.slice(line.indexOf("\t") + 1) : line.replace(/^group\.dev\.kopiyka\s*/, "")).trim();
const dbPath = join(groupPath, "kopiyka.db");
if (!existsSync(dbPath)) { console.error(`No database at ${dbPath}: launch the app once first.`); process.exit(1); }

const db = openBunDb(dbPath);
migrate(db);
const ACCOUNTS = { pln: "e2e-acc-pln", pln2: "e2e-acc-pln-2", usd: "e2e-acc-usd" };
const LEGS = { out: "e2e-leg-out", in: "e2e-leg-in" };

if (flag === "--clean") {
  const ids = Object.values(ACCOUNTS);
  // Every row on the test accounts, the legs the app paired or wrote, then the accounts themselves.
  for (const tx of listRows(db, "transactions", `deleted=0 AND account_id IN (${ids.map(() => "?").join(",")})`, ids)) remove(db, "transactions", tx.id);
  for (const id of ids) if (getRow(db, "accounts", id)) remove(db, "accounts", id);
} else {
  const ensure = (id: string, name: string, currency: string) => { if (!getRow(db, "accounts", id)) createAccount(db, { id, name, currency }); };
  ensure(ACCOUNTS.pln, "E2E PLN", "PLN");
  ensure(ACCOUNTS.pln2, "E2E PLN 2", "PLN");
  ensure(ACCOUNTS.usd, "E2E USD", "USD");
  const now = new Date();
  const iso = (d: Date) => d.toISOString().replace("Z", "+00:00").replace(/\.\d{3}/, "");
  if (!getRow(db, "transactions", LEGS.out)) {
    createTransaction(db, { id: LEGS.out, account_id: ACCOUNTS.usd, date: iso(now), amount_minor: -50000, payee: "E2E OWNER", notes: "PRZELEW IKO NA NUMER RACHUNKU",
      pending: 1, source: "shortcut", bank_ref: writeBankRef({ own: "3203", other: "5837", balance: 300000 }) });
  }
  if (!getRow(db, "transactions", LEGS.in)) {
    createTransaction(db, { id: LEGS.in, account_id: ACCOUNTS.pln, date: iso(new Date(now.getTime() + 120_000)), amount_minor: 188275, payee: "E2E OWNER", notes: "PRZELEW IKO NA NUMER RACHUNKU",
      pending: 1, source: "shortcut", bank_ref: writeBankRef({ own: "5837", other: "3203", balance: 206391 }) });
  }
}
db.raw.run("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
console.log(flag === "--clean" ? "Transfer test data removed." : `Transfer test data written to ${dbPath}.`);
