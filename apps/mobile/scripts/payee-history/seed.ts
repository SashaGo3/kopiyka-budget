/**
 * Builds the fixture database for the payee-history parity harness and answers every question in it
 * with core (`packages/core/src/payee.ts`), which is the reference the Swift copy has to match.
 *
 *   bun seed.ts <db path> <out dir>
 *
 * Writes <out dir>/questions.json (what to ask) and <out dir>/expected.json (core's answers).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openBunDb } from "../../../../packages/core/src/drivers/bun";
import { migrate } from "../../../../packages/core/src/schema";
import { createAccount, createCategory, createTransaction } from "../../../../packages/core/src/repo";
import { fillPending, payeeHistory, samePaymentSince } from "../../../../packages/core/src/payee";
import type { SqlDriver } from "../../../../packages/core/src/db";

const [dbPath, outDir] = process.argv.slice(2);
if (!dbPath || !outDir) { console.error("usage: bun seed.ts <db path> <out dir>"); process.exit(2); }
mkdirSync(outDir, { recursive: true });

/** An ISO timestamp with the local offset, `secondsAgo` in the past — the shape the app writes. */
const iso = (secondsAgo: number) => {
  const d = new Date(Date.now() - secondsAgo * 1_000);
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off < 0 ? "-" : "+"}${pad(off / 60)}:${pad(off % 60)}`;
};

/** The same fixture twice: once in the file Swift will open, once in memory for core's own answers. */
function build(db: SqlDriver) {
  migrate(db);
  const acc = createAccount(db, { id: "acc-main", name: "Main", currency: "PLN" });
  createAccount(db, { id: "acc-other", name: "Other", currency: "PLN" });
  const food = createCategory(db, { id: "cat-food", name: "Food" });
  createCategory(db, { id: "cat-subs", name: "Subscriptions" });
  const tx = (o: Parameters<typeof createTransaction>[1]) => createTransaction(db, o);

  // A chain: the older branch carries the location, the newer one the tags.
  tx({ id: "t-zabka-1", account_id: acc.id, date: "2026-09-01T10:00:00+02:00", amount_minor: -1000, payee: "ZABKA ZE212 K.5",
       category_id: food.id, tag_ids: JSON.stringify(["snack"]), place: "Zabka, Poznan", lat: 51.11, lon: 17.03 });
  tx({ id: "t-zabka-2", account_id: acc.id, date: "2026-09-05T10:00:00+02:00", amount_minor: -1200, payee: "ZABKA ZE212 K.5",
       category_id: food.id, tag_ids: JSON.stringify(["snack", "work"]) });
  // Filed under a note, never a payee.
  tx({ id: "t-gym", account_id: acc.id, date: "2026-09-02T10:00:00+02:00", amount_minor: -9900, notes: "Gym membership",
       category_id: "cat-subs", tag_ids: JSON.stringify(["health"]), place: "Zdrofit" });
  // Filed as a payee, asked about as a note.
  // An online BLIK purchase filed by hand. Another one paid the same way must not inherit it: the
  // only thing the two names share is how the money moved.
  tx({ id: "t-blik", account_id: acc.id, date: "2026-09-02T10:00:00+02:00", amount_minor: -8900, payee: "BLIK INTERNET: ALLEGRO.PL", category_id: "cat-subs" });
  tx({ id: "t-netflix", account_id: acc.id, date: "2026-09-03T10:00:00+02:00", amount_minor: -1000, payee: "Netflix", category_id: "cat-subs" });
  // Neither category nor tags: not a match.
  tx({ id: "t-unfiled", account_id: acc.id, date: "2026-09-04T10:00:00+02:00", amount_minor: -500, payee: "Unfiled Shop" });
  // A transfer leg is never a match.
  tx({ id: "t-transfer", account_id: acc.id, date: "2026-09-04T11:00:00+02:00", amount_minor: -700, payee: "Revolut", category_id: food.id, transfer_id: "tr-1" });

  // Twins for the one-minute duplicate window, dated relative to now: two inside it, one well outside.
  tx({ id: "t-twin-pending", account_id: acc.id, date: iso(15), amount_minor: -3300, payee: "ZABKA NANO 3087", pending: 1 });
  tx({ id: "t-twin-settled", account_id: acc.id, date: iso(25), amount_minor: -4400, payee: "Costa", pending: 0, category_id: food.id });
  tx({ id: "t-twin-old", account_id: acc.id, date: iso(300), amount_minor: -5500, payee: "Costa", pending: 1 });

  // Rows the fill-in cases mutate — one each, so nothing depends on the order questions are asked in.
  tx({ id: "t-fill-blank", account_id: acc.id, date: iso(30), amount_minor: -2100, pending: 1 });
  tx({ id: "t-fill-taken", account_id: acc.id, date: iso(30), amount_minor: -2200, pending: 1, payee: "ZABKA", place: "Katowice",
       tag_ids: JSON.stringify(["own"]), lat: 50.0, lon: 20.0 });
  tx({ id: "t-fill-settled", account_id: acc.id, date: iso(30), amount_minor: -2300, pending: 0 });
  tx({ id: "t-fill-nocat", account_id: acc.id, date: iso(30), amount_minor: -2400, pending: 1 });
}

interface Questions {
  history: { payee: string | null; note: string | null }[];
  payment: { account_id: string; amount_minor: number; payee: string | null; within_minutes: number }[];
  fill: { id: string; payee?: string; place?: string; category_id?: string; tag_ids?: string[]; lat?: number; lon?: number; confirm: boolean }[];
}

const questions: Questions = {
  history: [
    { payee: "zabka ze212 k.5", note: null },   // exact, case-insensitive
    { payee: "ZABKA NANO 3087", note: null },   // first-word fallback to another branch
    { payee: "Costco", note: null },            // unknown
    { payee: "Unfiled Shop", note: null },      // known name, nothing filed
    { payee: null, note: "gym membership" },    // a note that was filed as a note
    { payee: null, note: "Netflix" },           // a note that was filed as a payee
    { payee: null, note: "Gym" },               // a prefix of a note is not a match
    { payee: "Revolut", note: null },           // transfer leg
    { payee: "BLIK INTERNET: FLYSTORE.PL", note: null },  // another shop, same payment method: no match
    { payee: "BLIK INTERNET: ALLEGRO.PL", note: null },   // the same shop again: exact, and trusted
    { payee: "", note: "" },                    // nothing asked
  ],
  payment: [
    { account_id: "acc-main", amount_minor: -3300, payee: "ZABKA NANO 3087", within_minutes: 1 },  // pending twin
    { account_id: "acc-main", amount_minor: -4400, payee: "Costa", within_minutes: 1 },            // settled twin still counts
    { account_id: "acc-main", amount_minor: -5500, payee: "Costa", within_minutes: 1 },            // five minutes old: outside the window
    { account_id: "acc-other", amount_minor: -3300, payee: "ZABKA NANO 3087", within_minutes: 1 }, // other account
  ],
  fill: [
    { id: "t-fill-blank", payee: "Zabka Nano", place: "Krakow", category_id: "cat-food", tag_ids: ["snack"], lat: 51.1, lon: 17.03, confirm: true },
    { id: "t-fill-taken", payee: "Zabka Nano", place: "Krakow", category_id: "cat-food", tag_ids: ["new"], lat: 52.2, lon: 21.0, confirm: true },
    { id: "t-fill-settled", payee: "Zabka Nano", category_id: "cat-food", confirm: true },
    { id: "t-fill-nocat", place: "Krakow", tag_ids: ["snack"], confirm: true },
  ],
};

// Core's answers, on an identical in-memory copy.
const ref = openBunDb();
build(ref);
const row = (id: string) => {
  const r = ref.get<Record<string, unknown>>("SELECT id, payee, place, category_id, tag_ids, lat, lon, pending FROM transactions WHERE id=?", [id]);
  return r ?? null;
};
const expected = {
  history: questions.history.map((q) => payeeHistory(ref, q.payee, q.note)),
  payment: questions.payment.map((q) => {
    const twin = samePaymentSince(ref, { account_id: q.account_id, amount_minor: q.amount_minor, sinceIso: iso(q.within_minutes * 60) });
    return {
      history: payeeHistory(ref, q.payee, null),
      twin: twin ? { id: twin.id, payee: twin.payee, place: twin.place, category_id: twin.category_id, pending: twin.pending } : null,
    };
  }),
  fill: questions.fill.map((q) => {
    fillPending(ref, q.id, { payee: q.payee ?? null, place: q.place ?? null, category_id: q.category_id ?? null, tag_ids: q.tag_ids ?? null, lat: q.lat ?? null, lon: q.lon ?? null }, q.confirm);
    return row(q.id);
  }),
};

// The file Swift opens gets the untouched fixture; the fill-in cases are applied by Swift itself.
const file = openBunDb(dbPath);
build(file);
file.close();   // checkpoint the WAL: Swift opens this file with its own SQLite

writeFileSync(`${outDir}/questions.json`, JSON.stringify(questions, null, 2));
writeFileSync(`${outDir}/expected.json`, JSON.stringify(expected, null, 2));
console.log(`seeded ${dbPath} · ${questions.history.length} history, ${questions.payment.length} payment, ${questions.fill.length} fill-in questions`);
