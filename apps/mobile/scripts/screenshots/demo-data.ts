/**
 * Deterministic demo dataset for App Store screenshots, one per language: a Lisbon persona in EUR
 * for English, a Kyiv persona in UAH for Ukrainian. About 5 months of history, budgets sitting mid-range, a running trip and a finished one,
 * debts, insights and cached exchange rates — everything the screenshot flows need, built on a
 * throw-away in-memory database with the core API, then exported
 * as a normal `kopiyka-backup`.
 *
 *   bun apps/mobile/scripts/screenshots/demo-data.ts                    # writes screenshots/demo/kopiyka-demo-en.json
 *   bun apps/mobile/scripts/screenshots/demo-data.ts --lang=uk          # the Ukrainian set: kopiyka-demo-uk.json
 *   bun apps/mobile/scripts/screenshots/demo-data.ts --today=2026-09-12 # pin "today" (default: local today)
 *   bun apps/mobile/scripts/screenshots/demo-data.ts --apply=<udid>     # also install into that simulator
 *
 * The dataset is a small seeded PRNG over `today`, so the same --today always produces the same
 * file. Nothing here reads apps/mobile/data or any personal export — it is entirely invented.
 *
 * Words and numbers are kept apart. Every name a screenshot shows — shops, places, notes, accounts,
 * tags, trips, recurring payments, people — comes from the `demo` namespace
 * (packages/i18n/locales/<lang>/demo.json, compiled by `bun run i18n` into ./i18n/<lang>.json), and
 * the categories are the app's own presets seeded in that language. Amounts, coordinates and the
 * time zone are the `PROFILES` below: hryvnia prices are not euro prices times anything. The English
 * profile is the dataset as it was before languages existed, number for number and draw for draw.
 * The seeded database also carries meta `language` = the code, so the app opens in that language.
 */
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { migrate, setMeta, listRows, fromMinor, formatMinor, listTrips, tripStats, exportBackup, importBackup } from "@kopiyka/core";
import { openBunDb } from "@kopiyka/core/drivers/bun";
import { buildDemo } from "./demo-build";

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flagList = args.filter((a) => a.startsWith("--")).map((a) => { const i = a.indexOf("="); return i < 0 ? [a.slice(2), "true"] as const : [a.slice(2, i), a.slice(i + 1)] as const; });
const flags = new Map(flagList);
if (flags.has("help")) {
  console.error("usage: bun apps/mobile/scripts/screenshots/demo-data.ts [--lang=en|uk] [--today=YYYY-MM-DD] [--apply=<simulator udid>]");
  process.exit(0);
}
const TODAY = (flags.get("today") as string | undefined) ?? localToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) { console.error(`bad --today: ${TODAY}`); process.exit(1); }

const LANG = (flags.get("lang") as string | undefined) ?? "en";
const HERE = dirname(new URL(import.meta.url).pathname);
const MESSAGES_FILE = join(HERE, "i18n", `${LANG}.json`);
if (!existsSync(MESSAGES_FILE)) { console.error(`no demo text for "${LANG}" at ${MESSAGES_FILE} — run: bun run i18n`); process.exit(1); }
const MESSAGES = JSON.parse(readFileSync(MESSAGES_FILE, "utf8")) as Record<string, string>;

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const db = openBunDb();
const { rows, debts, balanceToday, periodStart: PERIOD_START, currency: CUR } = buildDemo(db, { lang: LANG, today: TODAY, messages: MESSAGES, stableIds: true });
const allCats = () => listRows(db, "categories", "deleted=0");

// ---------------------------------------------------------------------------------------------
// Export + write
// ---------------------------------------------------------------------------------------------

const backup = exportBackup(db, { includeDeleted: false });
const outPath = join(HERE, "..", "..", "screenshots", "demo", `kopiyka-demo-${LANG}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(backup, null, 1));

console.log(outPath);
console.log(`  lang=${LANG}  today=${TODAY}  period=${PERIOD_START}..${TODAY}`);
console.log(`  ${backup.accounts.length} accounts, ${backup.categories.length} categories, ${backup.tags.length} tags, ${backup.transactions.length} transactions, ${backup.recurring_rules.length} recurring rules, ${backup.budgets.length} budgets, ${backup.insights?.length ?? 0} insights, ${backup.debts?.length ?? 0} debts, ${backup.rates?.length ?? 0} rates`);
for (const a of listRows(db, "accounts", "deleted=0", [], "group_name, sort")) {
  console.log(`  ${a.group_name.padEnd(10)} ${a.name.padEnd(10)} ${fromMinor(balanceToday(a.id), a.currency).toFixed(2).padStart(12)} ${a.currency}`);
}
console.log("  budgets (current period):");
for (const r of rows) {
  const catName = allCats().find((c) => c.id === r.budget.category_id)?.name ?? "?";
  console.log(`    ${catName.padEnd(24)} ${formatMinor(r.spent_minor, CUR)} / ${formatMinor(r.budget.amount_minor, CUR)} ${CUR} (${((r.spent_minor / r.budget.amount_minor) * 100).toFixed(0)}%)`);
}
console.log("  trips:");
for (const b of listTrips(db)) { const s = tripStats(db, b, { today: TODAY }); console.log(`    ${s.name.padEnd(16)} ${formatMinor(s.spent_minor, s.currency)} / ${formatMinor(s.limit_minor, s.currency)} ${s.currency}${s.active ? " (active)" : " (ended)"}`); }
console.log("  debts:");
for (const d of debts) console.log(`    ${d.person.padEnd(10)} ${d.direction === "owed_to_me" ? "owed to me" : "I owe"} ${formatMinor(d.amount_minor, d.currency)} ${d.currency}${d.settled_date ? ` (settled ${d.settled_date})` : ""}`);

// ---------------------------------------------------------------------------------------------
// --apply: install into a booted simulator
// ---------------------------------------------------------------------------------------------

const applyUdid = flags.get("apply") as string | undefined;
if (applyUdid) {
  const BUNDLE_ID = "dev.kopiyka.app";
  try { execFileSync("xcrun", ["simctl", "terminate", applyUdid, BUNDLE_ID], { stdio: "ignore" }); } catch { /* not running: fine */ }

  let containerOut: string;
  try {
    containerOut = execFileSync("xcrun", ["simctl", "get_app_container", applyUdid, BUNDLE_ID, "groups"], { encoding: "utf8" });
  } catch (e) {
    console.error(`Could not find the App Group container for ${BUNDLE_ID} on simulator ${applyUdid}. Is the app installed there?\n${(e as Error).message}`);
    process.exit(1);
  }
  const line = containerOut.split("\n").map((l) => l.trim()).find((l) => l.includes("group.dev.kopiyka")) ?? containerOut.trim();
  const tab = line.indexOf("\t");
  const groupPath = (tab >= 0 ? line.slice(tab + 1) : line.replace(/^group\.dev\.kopiyka\s*/, "")).trim();
  if (!groupPath || !existsSync(groupPath)) { console.error(`Could not resolve the App Group path from:\n${containerOut}`); process.exit(1); }

  const dbPath = join(groupPath, "kopiyka.db");
  const target = openBunDb(dbPath);
  migrate(target);
  const report = importBackup(target, backup, { mode: "replace", applySettings: true });
  setMeta(target, "onboarded", "1");
  setMeta(target, "language", LANG);   // already in the file's settings; said again so it cannot drift
  target.raw.run("PRAGMA wal_checkpoint(TRUNCATE)");
  target.close();

  for (const stale of ["watch-state.json", "widget-snapshot.json"]) {
    const p = join(groupPath, stale);
    if (existsSync(p)) rmSync(p);
  }

  console.log(`\nApplied to simulator ${applyUdid} (${dbPath})`);
  console.log(`  imported: ${Object.entries(report.imported).map(([t, n]) => `${t}=${n}`).join(", ")}`);
  console.log(`  settings=${report.settings} rates=${report.rates}`);
}
