/**
 * Deterministic demo dataset for App Store screenshots: a Lisbon persona, base currency EUR,
 * about 5 months of history, budgets sitting mid-range, a running trip and a finished one,
 * debts, insights and cached exchange rates — everything the screenshot flows need, built on a
 * throw-away in-memory database with the core API, then exported
 * as a normal `kopiyka-backup`.
 *
 *   bun apps/mobile/scripts/screenshots/demo-data.ts                    # writes screenshots/demo/kopiyka-demo.json
 *   bun apps/mobile/scripts/screenshots/demo-data.ts --today=2026-09-12 # pin "today" (default: local today)
 *   bun apps/mobile/scripts/screenshots/demo-data.ts --apply=<udid>     # also install into that simulator
 *
 * The dataset is a small seeded PRNG over `today`, so the same --today always produces the same
 * file. Nothing here reads apps/mobile/data or any personal export — it is entirely invented.
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  migrate, setMeta, setHome,
  createAccount, createCategory, createTag, createTransaction, createRecurring, createBudget, createInsight, createDebt, createTransfer,
  listRows, accountBalanceMinor, toMinor, fromMinor, formatMinor, addPeriod, budgetPeriod,
  seedCategories, COLORS,
  startTrip, endTrip, tripStats, listTrips,
  listDebts, debtTotals, settleDebt,
  budgetRows, freeMoney, templateFromTransaction,
  exportBackup, importBackup,
  type Account, type Category, type Transaction, type RecurringRule,
} from "@kopiyka/core";
import { openBunDb } from "@kopiyka/core/drivers/bun";

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flagList = args.filter((a) => a.startsWith("--")).map((a) => { const i = a.indexOf("="); return i < 0 ? [a.slice(2), "true"] as const : [a.slice(2, i), a.slice(i + 1)] as const; });
const flags = new Map(flagList);
if (flags.has("help")) {
  console.error("usage: bun apps/mobile/scripts/screenshots/demo-data.ts [--today=YYYY-MM-DD] [--apply=<simulator udid>]");
  process.exit(0);
}
const TODAY = (flags.get("today") as string | undefined) ?? localToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) { console.error(`bad --today: ${TODAY}`); process.exit(1); }

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------------------------
// Small seeded PRNG (mulberry32) so the same --today always builds the same file.
// ---------------------------------------------------------------------------------------------

function seedFromString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seedFromString(`kopiyka-demo-${TODAY}`));

// Row ids too: @kopiyka/core's newId() calls crypto.randomUUID, which would hand out fresh ids on
// every run. capture.sh reads ids (the Restaurants category, the trip tag) out of the written JSON
// and puts them in deep links, so a JSON regenerated after the simulator was seeded used to point
// at rows that are not in the simulator's database — the entry sheet then opened with no category
// and the trip filter matched nothing. A separate stream keeps `rand` above untouched.
{
  const idRand = mulberry32(seedFromString(`kopiyka-demo-ids-${TODAY}`));
  // One PRNG draw per nibble: a float carries ~32 bits, so packing 12 hex digits out of one draw
  // would leave the tail of every id zeroed.
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(idRand() * 16).toString(16)).join("");
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(idRand() * 4)]}${hex(3)}-${hex(12)}` as `${string}-${string}-${string}-${string}-${string}`;
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: uuid, configurable: true, writable: true });
}

const chance = (p: number) => rand() < p;
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

// ---------------------------------------------------------------------------------------------
// Date / time helpers. Dates are YYYY-MM-DD; timestamps get Lisbon's real DST offset (WET/WEST)
// computed from the date, not the machine running the script, so the file is reproducible.
// ---------------------------------------------------------------------------------------------

function lastSundayUTC(year: number, month1to12: number): Date {
  const last = new Date(Date.UTC(year, month1to12, 0)); // last day of that month
  last.setUTCDate(last.getUTCDate() - last.getUTCDay());
  return last;
}
function lisbonOffsetMinutes(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const marchChange = lastSundayUTC(y, 3), octChange = lastSundayUTC(y, 10);
  return noon >= marchChange && noon < octChange ? 60 : 0; // WEST (+01:00) in summer, WET (+00:00) otherwise
}
function ts(day: string, hh: number, mm: number): string {
  const off = lisbonOffsetMinutes(day);
  const sign = off >= 0 ? "+" : "-";
  const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0"), om = String(Math.abs(off) % 60).padStart(2, "0");
  return `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${sign}${oh}:${om}`;
}
function daysList(startInclusive: string, endInclusive: string): string[] {
  const out: string[] = []; let d = startInclusive;
  while (d <= endInclusive) { out.push(d); d = addPeriod(d, "daily", 1); }
  return out;
}
function dayOfWeek(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function isWeekend(day: string): boolean {
  const dow = dayOfWeek(day);
  return dow === 0 || dow === 6;
}
/** All occurrences of a monthly/yearly cadence up to (and including) `today`, plus the first one after. */
function occurrencesUpTo(startDate: string, freq: "monthly" | "yearly", today: string): { past: string[]; next: string } {
  const past: string[] = []; let d = startDate;
  let guard = 0;
  while (d <= today && guard++ < 2000) { past.push(d); d = addPeriod(d, freq, 1); }
  return { past, next: d };
}

const HISTORY_START = addPeriod(TODAY, "monthly", -5);
const PERIOD_START_DAY = 25;
const { start: PERIOD_START } = budgetPeriod(TODAY, PERIOD_START_DAY);
const YESTERDAY = addPeriod(TODAY, "daily", -1);
const colorByName = (name: string) => COLORS.find((c) => c.name === name)!.hex;

// ---------------------------------------------------------------------------------------------
// Database + categories/tags
// ---------------------------------------------------------------------------------------------

const db = openBunDb();
migrate(db);

seedCategories(db);
const allCats = () => listRows(db, "categories", "deleted=0");
function folder(name: string): Category {
  const c = allCats().find((c) => c.parent_id === null && c.name === name);
  if (!c) throw new Error(`folder not found: ${name}`);
  return c;
}
function cat(folderName: string, name: string): Category {
  const f = folder(folderName);
  const c = allCats().find((c) => c.parent_id === f.id && c.name === name);
  if (!c) throw new Error(`category not found: ${folderName}/${name}`);
  return c;
}

const fShopping = folder("Shopping"), fTransport = folder("Transport");
const fHealth = folder("Health"), fPersonal = folder("Personal"), fFamily = folder("Family");

const catGroceries = cat("Food", "Groceries");
const catRestaurants = cat("Food", "Restaurants & cafés");
const catCoffee = cat("Food", "Coffee & snacks");
const catClothes = cat("Shopping", "Clothes & shoes");
const catElectronics = cat("Shopping", "Electronics");
const catHousehold = cat("Shopping", "Household");
const catWishes = cat("Shopping", "Wishes");
const catRent = cat("Home", "Rent");
const catUtilities = cat("Home", "Utilities");
const catInternet = cat("Home", "Internet & phone");
const catFurniture = cat("Home", "Furniture & repairs");
const catCar = cat("Transport", "Car");
const catFuel = cat("Transport", "Fuel");
const catPublicTransport = cat("Transport", "Public transport");
const catTaxi = cat("Transport", "Taxi");
const catPharmacy = cat("Health", "Pharmacy");
const catGym = cat("Health", "Gym & sport");
const catSubscriptions = cat("Bills", "Subscriptions");
const catEntertainment = cat("Fun & travel", "Entertainment");
const catTravel = cat("Fun & travel", "Travel");
const catPresents = cat("Fun & travel", "Presents");
const catKids = cat("Family", "Kids & baby");
const catSalary = cat("Income", "Salary");

// A couple of custom categories beyond the preset (per DATA.md rule 5, plain categories, not folders).
const catPortuguese = createCategory(db, { name: "Portuguese classes", parent_id: fPersonal.id, icon: "graduationcap.fill", color: fPersonal.color, kind: "expense", description: "Portuguese language classes" });
const catPadel = createCategory(db, { name: "Padel", parent_id: fHealth.id, icon: "tennis.racket", color: fHealth.color, kind: "expense", description: "padel court booking" });

const tagLunch = createTag(db, { name: "Lunch", color: colorByName("orange"), category_ids: JSON.stringify([catRestaurants.id]) });
const tagWork = createTag(db, { name: "Work", color: colorByName("blue") });
const tagWeekend = createTag(db, { name: "Weekend", color: colorByName("green") });
const tagGift = createTag(db, { name: "Gift", color: colorByName("pink") });
const tagKids = createTag(db, { name: "Kids", color: colorByName("amber"), category_ids: JSON.stringify([fFamily.id]) });
const tagCoffee = createTag(db, { name: "Coffee", color: colorByName("brown") });

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

// The 6 Revolut (USD card) purchases are fixed amounts so the opening balance can be computed
// exactly to land the account at ~900 USD today, per the brief.
const revolutTx: { date: string; hh: number; amount: number; payee: string; category: Category; place?: string; lat?: number; lon?: number }[] = [
  { date: addPeriod(TODAY, "monthly", -4), hh: 9, amount: -2.99, payee: "Apple", category: catSubscriptions },
  { date: addPeriod(TODAY, "monthly", -3), hh: 21, amount: -34.5, payee: "Amazon.com", category: catElectronics },
  { date: addPeriod(TODAY, "monthly", -2), hh: 10, amount: -12.99, payee: "Adobe", category: catSubscriptions },
  { date: addPeriod(TODAY, "monthly", -1), hh: 20, amount: -0.99, payee: "Apple", category: catSubscriptions },
  { date: addPeriod(TODAY, "daily", -18), hh: 16, amount: -58.2, payee: "Amazon.com", category: catWishes },
  { date: addPeriod(TODAY, "daily", -6), hh: 22, amount: -9.99, payee: "Apple", category: catSubscriptions },
];
const revolutTotalMinor = revolutTx.reduce((a, t) => a + toMinor(t.amount, "USD"), 0);
const revolutOpening = toMinor(900, "USD") - revolutTotalMinor;

// Monthly 400 EUR Main -> Savings transfers on the 26th, back to well before HISTORY_START; only
// the ones inside the demo window are actually posted, but all of them count towards "today's"
// Savings balance, which is why the opening balance is computed from all of them.
const { past: allTransferDays } = occurrencesUpTo("2022-01-26", "monthly", TODAY);
const postedTransferDays = allTransferDays.filter((d) => d >= HISTORY_START);
// Only the transfers actually posted (inside the demo window) move the balance we can see; the
// opening balance stands in for everything before that, so it is target minus just those.
const savingsOpening = toMinor(6400, "EUR") - postedTransferDays.length * toMinor(400, "EUR");

const main = createAccount(db, { name: "Main", currency: "EUR", type: "bank", icon: "building.columns.fill", color: colorByName("blue"), opening_balance_minor: toMinor(350.75, "EUR"), sort: 0 });
const savings = createAccount(db, { name: "Savings", currency: "EUR", type: "savings", icon: "leaf.fill", color: colorByName("teal"), opening_balance_minor: savingsOpening, sort: 2 });
const revolut = createAccount(db, { name: "Revolut", currency: "USD", type: "card", icon: "creditcard.fill", color: colorByName("violet"), opening_balance_minor: revolutOpening, sort: 3 });
// Cash and Joint are created further down, once every spec that spends from them exists — their
// opening balance is computed backwards from that total so today's balance lands somewhere sane.

setMeta(db, "current_account", main.id);
setMeta(db, "budget_scope", main.id);
setMeta(db, "base_currency", "EUR");
setMeta(db, "period_start_day", String(PERIOD_START_DAY));
setMeta(db, "location_enabled", "1");
setHome(db, { lat: 38.7223, lon: -9.1393, place: "Rua da Prata, Lisboa" });
setMeta(db, "show_balance", "1");

// ---------------------------------------------------------------------------------------------
// Merchants (name, category, place, coordinates repeated per merchant so suggestCategoryNear
// would find them, amount range in the account's own currency).
// ---------------------------------------------------------------------------------------------

interface Merchant { name: string; category: Category; place: string; lat: number; lon: number; min: number; max: number }
const M = {
  groceries: [
    { name: "Pingo Doce", category: catGroceries, place: "Pingo Doce, Av. da Liberdade", lat: 38.7223, lon: -9.145, min: 12, max: 55 },
    { name: "Continente", category: catGroceries, place: "Continente, Almirante Reis", lat: 38.7278, lon: -9.1352, min: 18, max: 75 },
    { name: "Lidl", category: catGroceries, place: "Lidl, Alcântara", lat: 38.7057, lon: -9.1774, min: 10, max: 45 },
    { name: "Mercado da Ribeira", category: catGroceries, place: "Mercado da Ribeira, Cais do Sodré", lat: 38.7069, lon: -9.1459, min: 8, max: 30 },
  ],
  coffee: [
    { name: "Starbucks", category: catCoffee, place: "Starbucks, Rossio", lat: 38.7145, lon: -9.1394, min: 2.2, max: 4.8 },
    { name: "A Brasileira", category: catCoffee, place: "A Brasileira, Chiado", lat: 38.7107, lon: -9.1427, min: 1.2, max: 3.6 },
  ],
  lunch: [
    { name: "Time Out Market", category: catRestaurants, place: "Time Out Market, Cais do Sodré", lat: 38.7069, lon: -9.1459, min: 9, max: 18 },
    { name: "Cervejaria Ramiro", category: catRestaurants, place: "Cervejaria Ramiro, Intendente", lat: 38.7223, lon: -9.135, min: 12, max: 26 },
  ],
  dinner: [
    { name: "Time Out Market", category: catRestaurants, place: "Time Out Market, Cais do Sodré", lat: 38.7069, lon: -9.1459, min: 16, max: 32 },
    { name: "Cervejaria Ramiro", category: catRestaurants, place: "Cervejaria Ramiro, Intendente", lat: 38.7223, lon: -9.135, min: 20, max: 45 },
    { name: "A Brasileira", category: catRestaurants, place: "A Brasileira, Chiado", lat: 38.7107, lon: -9.1427, min: 14, max: 28 },
  ],
  taxi: [
    { name: "Uber", category: catTaxi, place: "Uber", lat: 38.7167, lon: -9.1395, min: 4.5, max: 13 },
    { name: "Bolt", category: catTaxi, place: "Bolt", lat: 38.7167, lon: -9.1395, min: 4, max: 12 },
  ],
  publicTransport: [{ name: "Metro Lisboa", category: catPublicTransport, place: "Metro Lisboa, Baixa-Chiado", lat: 38.7107, lon: -9.1396, min: 1.65, max: 6.4 }],
  fuel: [{ name: "Galp", category: catFuel, place: "Galp, Av. Almirante Reis", lat: 38.735, lon: -9.15, min: 42, max: 62 }],
  clothes: [{ name: "Zara", category: catClothes, place: "Zara, Chiado", lat: 38.7106, lon: -9.1421, min: 18, max: 65 }],
  electronics: [{ name: "FNAC", category: catElectronics, place: "FNAC, Chiado", lat: 38.7106, lon: -9.1419, min: 15, max: 90 }],
  hobbies: [{ name: "Decathlon", category: cat("Personal", "Hobbies"), place: "Decathlon, Amoreiras", lat: 38.7227, lon: -9.1608, min: 12, max: 60 }],
  furniture: [{ name: "IKEA", category: catFurniture, place: "IKEA, Alfragide", lat: 38.7495, lon: -9.2258, min: 25, max: 140 }],
  pharmacy: [{ name: "Farmácia", category: catPharmacy, place: "Farmácia, Baixa", lat: 38.7139, lon: -9.1387, min: 4, max: 22 }],
  entertainment: [{ name: "Cinema São Jorge", category: catEntertainment, place: "Cinema São Jorge, Av. da Liberdade", lat: 38.7211, lon: -9.1467, min: 8.5, max: 12.5 }],
  presents: [{ name: "Florista", category: catPresents, place: "Florista, Chiado", lat: 38.711, lon: -9.142, min: 15, max: 40 }, { name: "Livraria Bertrand", category: catPresents, place: "Livraria Bertrand, Chiado", lat: 38.7107, lon: -9.1418, min: 12, max: 35 }],
  kids: [{ name: "H&M Kids", category: catKids, place: "H&M, Chiado", lat: 38.7108, lon: -9.1423, min: 15, max: 45 }, { name: "Chicco", category: catKids, place: "Chicco, Colombo", lat: 38.7592, lon: -9.1975, min: 18, max: 55 }],
} as const satisfies Record<string, readonly Merchant[]>;

// ---------------------------------------------------------------------------------------------
// Transaction spec accumulator
// ---------------------------------------------------------------------------------------------

type Acct = "Main" | "Cash" | "Revolut" | "Joint";
interface TxSpec {
  date: string; hh: number; mm: number; amountMinor: number; currency: string; account: Acct;
  category: Category | null; payee?: string | null; notes?: string | null; tagIds?: string[];
  lat?: number; lon?: number; place?: string; pending?: 0 | 1; source?: string | null; recurringId?: string | null;
}
const specs: TxSpec[] = [];

function addSpec(m: Merchant, day: string, hh: number, mmMin: number, account: Acct, opts: { tagIds?: string[]; geo?: boolean; amount?: number } = {}) {
  const amount = -(opts.amount ?? Math.round((m.min + rand() * (m.max - m.min)) * 100) / 100);
  const s: TxSpec = { date: day, hh, mm: mmMin, amountMinor: toMinor(amount, account === "Revolut" ? "USD" : "EUR"), currency: account === "Revolut" ? "USD" : "EUR", account, category: m.category, notes: m.name, tagIds: opts.tagIds ?? [] };
  if (chance(0.4) && opts.geo !== false) { s.lat = m.lat; s.lon = m.lon; s.place = m.place; }
  specs.push(s);
}

// -- Phase A: loose weekly cadence for the months before the current period ---------------------
for (const day of daysList(HISTORY_START, addPeriod(PERIOD_START, "daily", -1))) {
  const weekend = isWeekend(day);
  const tags = (base: string[]) => { const t = [...base]; if (weekend && chance(0.5)) t.push(tagWeekend.id); if (!weekend && chance(0.12)) t.push(tagWork.id); return t; };

  if (chance(weekend ? 0.35 : 0.5)) addSpec(pick(M.coffee), day, weekend ? 9 : 8, randInt(0, 45), pick<Acct>(["Main", "Main", "Cash"]), { tagIds: tags(chance(0.45) ? [tagCoffee.id] : []) });
  if (!weekend && chance(0.35)) addSpec(pick(M.lunch), day, 13, randInt(0, 40), "Main", { tagIds: tags(chance(0.65) ? [tagLunch.id] : []) });
  if (weekend && chance(0.3)) addSpec(pick(M.dinner), day, 20, randInt(0, 40), "Main", { tagIds: tags([]) });
  if (chance(0.28)) addSpec(pick(M.groceries), day, weekend ? 11 : 18, randInt(0, 45), pick<Acct>(["Main", "Main", "Cash"]), { tagIds: tags([]) });
  if (!weekend && chance(0.2)) addSpec(M.publicTransport[0]!, day, chance(0.5) ? 8 : 18, randInt(0, 20), "Main", { tagIds: tags([]) });
  if (weekend && chance(0.2)) addSpec(pick(M.taxi), day, 23, randInt(0, 50), "Cash", { tagIds: tags([]) });
  if (chance(0.03)) addSpec(M.fuel[0]!, day, 17, randInt(0, 30), "Main", { tagIds: tags([]) });
  if (chance(0.03)) addSpec(pick([...M.clothes, ...M.electronics, ...M.hobbies]), day, 17, randInt(0, 50), "Main", { tagIds: tags([]) });
  if (chance(0.01)) addSpec(M.furniture[0]!, day, 17, randInt(0, 40), "Main", { tagIds: tags([]) });
  if (chance(0.04)) addSpec(M.pharmacy[0]!, day, 18, randInt(0, 40), "Main", { tagIds: tags([]) });
  if (weekend && chance(0.1)) addSpec(M.entertainment[0]!, day, 21, randInt(0, 20), "Cash", { tagIds: tags([]) });
  if (chance(0.015)) addSpec(pick(M.presents), day, 18, randInt(0, 40), "Main", { tagIds: [tagGift.id] });
  if (chance(0.015)) addSpec(pick(M.kids), day, 17, randInt(0, 40), "Main", { tagIds: [tagKids.id] });
  // Weekly fixed activities: Portuguese classes on Tuesdays, padel on Wednesdays.
  const dow = dayOfWeek(day);
  if (dow === 2) specs.push({ date: day, hh: 19, mm: 0, amountMinor: -toMinor(45, "EUR"), currency: "EUR", account: "Main", category: catPortuguese, notes: "Portuguese classes" });
  if (dow === 3) specs.push({ date: day, hh: 20, mm: 30, amountMinor: -toMinor(12, "EUR"), currency: "EUR", account: "Cash", category: catPadel, notes: "Padel" });
}

// -- Madrid, a finished trip: today-60 .. today-56 -----------------------------------------------
const madridStart = addPeriod(TODAY, "daily", -60), madridEnd = addPeriod(TODAY, "daily", -56);
const { budget: madridBudget, tag: madridTag } = startTrip(db, { name: "Madrid", currency: "EUR", amount_minor: toMinor(800, "EUR"), starts: madridStart, ends: madridEnd });
endTrip(db, madridBudget.id, madridEnd);
const madridRows: TxSpec[] = [
  { date: madridStart, hh: 15, mm: 0, amountMinor: -toMinor(140, "EUR"), currency: "EUR", account: "Main", category: catTravel, notes: "Hotel Madrid", tagIds: [madridTag.id] },
  { date: madridStart, hh: 21, mm: 0, amountMinor: -toMinor(34, "EUR"), currency: "EUR", account: "Cash", category: catRestaurants, notes: "Dinner, Madrid", tagIds: [madridTag.id] },
  { date: addPeriod(madridStart, "daily", 1), hh: 16, mm: 0, amountMinor: -toMinor(15, "EUR"), currency: "EUR", account: "Cash", category: catEntertainment, notes: "Museo del Prado", tagIds: [madridTag.id] },
  { date: addPeriod(madridStart, "daily", 1), hh: 12, mm: 0, amountMinor: -toMinor(9.5, "EUR"), currency: "EUR", account: "Cash", category: catPublicTransport, notes: "Metro Madrid", tagIds: [madridTag.id] },
];
specs.push(...madridRows);

// -- Phase B: the current period (25 Aug -> today), dense and hitting budget targets ------------
const periodDays = daysList(PERIOD_START, TODAY);
// Bias today/yesterday so both are populated — but only when they actually fall inside the period
// (a --today equal to the period's start day makes "yesterday" the previous period instead).
const datePool = [...periodDays, TODAY, TODAY, YESTERDAY, YESTERDAY].filter((d) => d >= PERIOD_START);
const periodDay = () => pick(datePool);

/** Split a target minor total across `count` transactions that sum to it exactly. */
function splitExactly(targetMinor: number, count: number, minMajor: number, maxMajor: number): number[] {
  const raw = Array.from({ length: count }, () => randInt(Math.round(minMajor * 100), Math.round(maxMajor * 100)));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const scale = targetMinor / sum;
  const out = raw.map((v) => Math.round(v * scale));
  const drift = targetMinor - out.reduce((a, b) => a + b, 0);
  out[out.length - 1] = out[out.length - 1]! + drift; // absorb rounding into the last row
  return out;
}

function budgetedGroup(merchants: readonly Merchant[], targetMinor: number, count: number, hh: [number, number], acct: Acct[], range: [number, number] = [3, 40], tagFor?: (day: string) => string[]) {
  for (const amt of splitExactly(targetMinor, count, range[0], range[1])) {
    const day = periodDay();
    const m = pick(merchants);
    const hour = randInt(hh[0], hh[1]);
    const s: TxSpec = { date: day, hh: hour, mm: randInt(0, 55), amountMinor: -amt, currency: "EUR", account: pick(acct), category: m.category, notes: m.name, tagIds: tagFor ? tagFor(day) : [] };
    if (chance(0.4)) { s.lat = m.lat; s.lon = m.lon; s.place = m.place; }
    specs.push(s);
  }
}

// Groceries 450 -> ~62%; Restaurants & cafés 220 -> ~55%; Coffee & snacks 60 -> ~108% (slightly over).
budgetedGroup(M.groceries, Math.round(45000 * 0.62), 6, [11, 19], ["Main", "Main", "Cash"], [8, 50]);
// (Restaurants & cafés also picks up the Porto trip's meals below, so the base target here is
// deliberately lower than the others: base + trip spend should land mid-range together.)
budgetedGroup([...M.lunch, ...M.dinner], Math.round(22000 * 0.25), 6, [13, 21], ["Main"], [9, 35], (day) => (isWeekend(day) ? [tagWeekend.id] : chance(0.6) ? [tagLunch.id] : []));
budgetedGroup(M.coffee, Math.round(6000 * 1.08), 14, [8, 17], ["Main", "Cash"], [1.5, 5], () => (chance(0.5) ? [tagCoffee.id] : []));

// Transport folder 120 -> ~50%, spread across taxi/public transport/fuel.
budgetedGroup(M.taxi, Math.round(12000 * 0.3), 5, [18, 23], ["Cash", "Main"], [4, 14]);
budgetedGroup(M.publicTransport, Math.round(12000 * 0.15), 4, [8, 19], ["Main"], [1.5, 6]);
budgetedGroup(M.fuel, Math.round(12000 * 0.05), 1, [17, 18], ["Main"], [40, 60]);

// Entertainment 80 -> ~45%.
budgetedGroup(M.entertainment, Math.round(8000 * 0.45), 3, [20, 22], ["Cash", "Main"], [8, 13], (day) => (isWeekend(day) ? [tagWeekend.id] : []));

// Household 90 -> ~50% (its own budget); Shopping folder 250 -> ~40% total, Household's share included.
const householdMerchant: Merchant = { name: "IKEA", category: catHousehold, place: "IKEA, Alfragide", lat: 38.7495, lon: -9.2258, min: 8, max: 45 };
budgetedGroup([householdMerchant], Math.round(9000 * 0.5), 3, [17, 19], ["Main"], [8, 45]);
budgetedGroup(M.clothes, Math.round(5500 * 0.4), 1, [17, 19], ["Main"], [15, 65]);
budgetedGroup(M.electronics, Math.round(5500 * 0.35), 1, [17, 19], ["Main"], [15, 90]);
budgetedGroup(M.hobbies, Math.round(5500 * 0.25), 1, [17, 19], ["Main"], [10, 60]);

// A little unbudgeted padding: pharmacy, presents, kids, weekly classes, transfer and Revolut rows already add up.
specs.push({ date: periodDay(), hh: 18, mm: 20, amountMinor: -toMinor(9.9, "EUR"), currency: "EUR", account: "Main", category: catPharmacy, notes: "Farmácia" });
specs.push({ date: periodDay(), hh: 18, mm: 40, amountMinor: -toMinor(28, "EUR"), currency: "EUR", account: "Main", category: catPresents, notes: "Livraria Bertrand", tagIds: [tagGift.id] });
specs.push({ date: periodDay(), hh: 17, mm: 10, amountMinor: -toMinor(32, "EUR"), currency: "EUR", account: "Main", category: catKids, notes: "H&M Kids", tagIds: [tagKids.id] });
for (const day of periodDays) {
  const dow = dayOfWeek(day);
  if (dow === 2) specs.push({ date: day, hh: 19, mm: 0, amountMinor: -toMinor(45, "EUR"), currency: "EUR", account: "Main", category: catPortuguese, notes: "Portuguese classes" });
  if (dow === 3) specs.push({ date: day, hh: 20, mm: 30, amountMinor: -toMinor(12, "EUR"), currency: "EUR", account: "Cash", category: catPadel, notes: "Padel" });
}

// -- Porto weekend, the active trip: today-2 .. today+2 ------------------------------------------
const portoStart = addPeriod(TODAY, "daily", -2), portoEnd = addPeriod(TODAY, "daily", 2);
const { tag: portoTag } = startTrip(db, { name: "Porto weekend", currency: "EUR", amount_minor: toMinor(600, "EUR"), starts: portoStart, ends: portoEnd });
const portoRows: TxSpec[] = [
  { date: portoStart, hh: 12, mm: 0, amountMinor: -toMinor(32.6, "EUR"), currency: "EUR", account: "Main", category: catPublicTransport, notes: "Train CP", tagIds: [portoTag.id] },
  { date: portoStart, hh: 16, mm: 0, amountMinor: -toMinor(189, "EUR"), currency: "EUR", account: "Main", category: catTravel, notes: "Hotel", tagIds: [portoTag.id] },
  { date: portoStart, hh: 20, mm: 30, amountMinor: -toMinor(38, "EUR"), currency: "EUR", account: "Cash", category: catRestaurants, notes: "Dinner, Porto", tagIds: [portoTag.id] },
  { date: YESTERDAY, hh: 19, mm: 0, amountMinor: -toMinor(11, "EUR"), currency: "EUR", account: "Cash", category: catEntertainment, notes: "Port wine tasting", tagIds: [portoTag.id] },
  { date: YESTERDAY, hh: 21, mm: 0, amountMinor: -toMinor(41, "EUR"), currency: "EUR", account: "Cash", category: catRestaurants, notes: "Dinner, Porto", tagIds: [portoTag.id] },
  { date: TODAY, hh: 13, mm: 30, amountMinor: -toMinor(14.5, "EUR"), currency: "EUR", account: "Cash", category: catRestaurants, notes: "Francesinha", tagIds: [portoTag.id] },
];
specs.push(...portoRows);

// -- Revolut (USD) purchases ----------------------------------------------------------------------
for (const t of revolutTx) specs.push({ date: t.date, hh: t.hh, mm: randInt(0, 55), amountMinor: toMinor(t.amount, "USD"), currency: "USD", account: "Revolut", category: t.category, notes: t.payee });

// -- Joint (the one or two shared-account rows) --------------------------------------------------
specs.push({ date: addPeriod(TODAY, "monthly", -3), hh: 11, mm: 0, amountMinor: -toMinor(64.5, "EUR"), currency: "EUR", account: "Joint", category: catGroceries, notes: "Continente" });
specs.push({ date: addPeriod(TODAY, "monthly", -2), hh: 17, mm: 0, amountMinor: -toMinor(118, "EUR"), currency: "EUR", account: "Joint", category: catHousehold, notes: "IKEA" });

// Cash and Joint: opening balance computed backwards from every spec that spends from them, so
// today's balance lands on a sane, positive number instead of drifting wherever chance took it.
const cashSpentMinor = specs.filter((s) => s.account === "Cash").reduce((a, s) => a + s.amountMinor, 0);
const jointSpentMinor = specs.filter((s) => s.account === "Joint").reduce((a, s) => a + s.amountMinor, 0);
const cash = createAccount(db, { name: "Cash", currency: "EUR", type: "cash", icon: "banknote.fill", color: colorByName("green"), opening_balance_minor: toMinor(150, "EUR") - cashSpentMinor, sort: 1 });
const joint = createAccount(db, { name: "Joint", currency: "EUR", type: "bank", group_name: "Family", icon: "person.2.fill", color: colorByName("indigo"), opening_balance_minor: toMinor(400, "EUR") - jointSpentMinor, sort: 0 });

// ---------------------------------------------------------------------------------------------
// Recurring rules + their historic postings
// ---------------------------------------------------------------------------------------------

const accountOf: Record<Acct, Account> = { Main: main, Cash: cash, Revolut: revolut, Joint: joint };

interface RuleSpec { name: string; day: number; amount: number; category: Category; autoPost: 0 | 1; freq: "monthly" | "yearly"; time: string; anchor: string }
const ruleSpecs: RuleSpec[] = [
  { name: "Rent", day: 1, amount: -1250, category: catRent, autoPost: 0, freq: "monthly", time: "09:00", anchor: "2023-01-01" },
  { name: "iCloud", day: 3, amount: -2.99, category: catSubscriptions, autoPost: 1, freq: "monthly", time: "00:05", anchor: "2023-01-03" },
  { name: "Spotify", day: 5, amount: -10.99, category: catSubscriptions, autoPost: 1, freq: "monthly", time: "09:15", anchor: "2023-01-05" },
  { name: "Netflix", day: 8, amount: -15.99, category: catSubscriptions, autoPost: 1, freq: "monthly", time: "10:30", anchor: "2023-01-08" },
  { name: "Gym", day: 10, amount: -39.9, category: catGym, autoPost: 1, freq: "monthly", time: "07:00", anchor: "2023-01-10" },
  { name: "Vodafone", day: 12, amount: -29.9, category: catInternet, autoPost: 1, freq: "monthly", time: "09:00", anchor: "2023-01-12" },
  { name: "EDP energy", day: 18, amount: -62, category: catUtilities, autoPost: 0, freq: "monthly", time: "09:00", anchor: "2023-01-18" },
  { name: "Salary", day: 25, amount: 3850, category: catSalary, autoPost: 1, freq: "monthly", time: "09:00", anchor: "2023-01-25" },
];
const CAR_INSURANCE_ANCHOR = "2022-11-05"; // yearly, no occurrence inside the demo window

const rules: RecurringRule[] = [];
const templatesByName = new Map<string, Transaction>();

for (const rs of ruleSpecs) {
  const startDate = rs.anchor;
  const { past, next } = occurrencesUpTo(startDate, "monthly", TODAY);
  const rule = createRecurring(db, {
    account_id: main.id, amount_minor: toMinor(rs.amount, "EUR"), category_id: rs.category.id, payee: rs.name,
    frequency: "monthly", interval: 1, start_date: startDate, next_date: next, notify: 1, notify_days_before: 1,
    auto_post: rs.autoPost, active: 1, time_of_day: rs.time,
  });
  rules.push(rule);
  for (const day of past.filter((d) => d >= HISTORY_START)) {
    const tx = createTransaction(db, { account_id: main.id, date: ts(day, ...timeParts(rs.time)), amount_minor: toMinor(rs.amount, "EUR"), category_id: rs.category.id, payee: rs.name, recurring_id: rule.id });
    templatesByName.set(rs.name, tx);
  }
}
const carInsurance = createRecurring(db, {
  account_id: main.id, amount_minor: toMinor(-380, "EUR"), category_id: catCar.id, payee: "Car insurance",
  frequency: "yearly", interval: 1, start_date: CAR_INSURANCE_ANCHOR, next_date: occurrencesUpTo(CAR_INSURANCE_ANCHOR, "yearly", TODAY).next,
  notify: 1, notify_days_before: 1, auto_post: 1, active: 1, time_of_day: "09:00",
});
rules.push(carInsurance);

function timeParts(hhmm: string): [number, number] { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return [h, m]; }

// ---------------------------------------------------------------------------------------------
// Materialise every ordinary transaction spec + the monthly Main -> Savings transfer
// ---------------------------------------------------------------------------------------------

for (const s of specs) {
  createTransaction(db, {
    account_id: accountOf[s.account].id, date: ts(s.date, s.hh, s.mm), amount_minor: s.amountMinor,
    category_id: s.category?.id ?? null, notes: s.notes ?? null, payee: s.payee ?? null,
    tag_ids: JSON.stringify(s.tagIds ?? []), lat: s.lat ?? null, lon: s.lon ?? null, place: s.place ?? null,
    pending: s.pending ?? 0, source: s.source ?? null,
  });
}
for (const day of postedTransferDays) {
  createTransfer(db, { from_account_id: main.id, to_account_id: savings.id, date: ts(day, 10, 0), from_amount_minor: toMinor(400, "EUR"), to_amount_minor: toMinor(400, "EUR"), from_currency: "EUR", to_currency: "EUR", notes: "Savings" });
}

// The one pending row Shortcuts is meant to demonstrate.
createTransaction(db, { account_id: main.id, date: ts(TODAY, 20, 5), amount_minor: -toMinor(7.4, "EUR"), category_id: catTaxi.id, notes: "Bolt", pending: 1, source: "shortcut-guess" });

// ---------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------

const budgetSpecs: { category: Category; amount: number }[] = [
  { category: catGroceries, amount: 450 }, { category: catRestaurants, amount: 220 }, { category: catCoffee, amount: 60 },
  { category: fTransport, amount: 120 }, { category: catEntertainment, amount: 80 }, { category: fShopping, amount: 250 }, { category: catHousehold, amount: 90 },
];
for (const b of budgetSpecs) createBudget(db, { category_id: b.category.id, currency: "EUR", amount_minor: toMinor(b.amount, "EUR"), period: "monthly", starts: PERIOD_START, start_day: PERIOD_START_DAY, account_id: main.id });

// ---------------------------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------------------------

// Open debts first (the Debts screen lists them newest-due first), then two settled ones for history.
createDebt(db, { person: "Oleksandr", direction: "owed_to_me", amount_minor: toMinor(120, "EUR"), currency: "EUR", account_id: main.id, opened_date: addPeriod(TODAY, "daily", -9), due_date: addPeriod(TODAY, "daily", 5), notes: "Concert tickets", notify: 1 });
createDebt(db, { person: "Daryna", direction: "i_owe", amount_minor: toMinor(350, "EUR"), currency: "EUR", opened_date: addPeriod(TODAY, "daily", -20), due_date: addPeriod(TODAY, "daily", 12), notes: "Bike" });
createDebt(db, { person: "Olga", direction: "owed_to_me", amount_minor: toMinor(45, "USD"), currency: "USD", opened_date: addPeriod(TODAY, "daily", -40), due_date: null, notes: "Dinner in NYC" });
createDebt(db, { person: "Maksym", direction: "owed_to_me", amount_minor: toMinor(80, "EUR"), currency: "EUR", account_id: main.id, opened_date: addPeriod(TODAY, "daily", -6), due_date: addPeriod(TODAY, "daily", 20), notes: "Padel court", notify: 1 });
createDebt(db, { person: "Oleski", direction: "i_owe", amount_minor: toMinor(25, "EUR"), currency: "EUR", opened_date: addPeriod(TODAY, "daily", -3), due_date: null, notes: "Lunch" });
createDebt(db, { person: "Azuki", direction: "owed_to_me", amount_minor: toMinor(200, "EUR"), currency: "EUR", opened_date: addPeriod(TODAY, "daily", -15), due_date: addPeriod(TODAY, "daily", -2), notes: "Festival ticket", notify: 1 }); // overdue
const pusik = createDebt(db, { person: "Pusik", direction: "owed_to_me", amount_minor: toMinor(60, "EUR"), currency: "EUR", opened_date: addPeriod(TODAY, "daily", -50) });
settleDebt(db, pusik.id, { day: addPeriod(TODAY, "daily", -30) });
const siri = createDebt(db, { person: "Siri", direction: "i_owe", amount_minor: toMinor(40, "EUR"), currency: "EUR", opened_date: addPeriod(TODAY, "daily", -35), notes: "Cinema" });
settleDebt(db, siri.id, { day: addPeriod(TODAY, "daily", -21) });

// ---------------------------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------------------------

createInsight(db, { kind: "free_money", sort: 0 });
createInsight(db, { kind: "days_to_salary", sort: 1 });
createInsight(db, { kind: "savings_goal", sort: 2, params: JSON.stringify({ title: "Emergency fund", account_id: savings.id, target_minor: toMinor(10000, "EUR") }) });
createInsight(db, { kind: "checklist", sort: 3, params: JSON.stringify({ category_ids: [catRent.id, catUtilities.id, catInternet.id] }) });
createInsight(db, { kind: "subscriptions", sort: 4 });
createInsight(db, { kind: "regular", sort: 5, params: JSON.stringify({ category_ids: [catGroceries.id], frequency: "weekly" }) });
const gymTpl = templatesByName.get("Gym"), vodafoneTpl = templatesByName.get("Vodafone");
if (gymTpl && vodafoneTpl) {
  createInsight(db, { kind: "upcoming", sort: 6, params: JSON.stringify({ templates: [templateFromTransaction(gymTpl), templateFromTransaction(vodafoneTpl)] }) });
}

// ---------------------------------------------------------------------------------------------
// Exchange rates (offline demo: no network needed). Frankfurter convention: rate = quote per base.
// ---------------------------------------------------------------------------------------------

const rateDays = new Set<string>([TODAY, ...revolutTx.map((t) => t.date)]);
for (const day of rateDays) {
  db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["USD", "EUR", day, 0.92, Date.now()]);
  db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["EUR", "USD", day, 1.087, Date.now()]);
}
db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, ["EUR", "PLN", TODAY, 4.28, Date.now()]);

// ---------------------------------------------------------------------------------------------
// Validate: run the same core queries the app runs, and refuse to write a broken file.
// ---------------------------------------------------------------------------------------------

function assertTrue(cond: boolean, msg: string): void { if (!cond) throw new Error(`demo-data validation failed: ${msg}`); }

// accountBalanceMinor defaults to excluding anything dated after the *real* wall-clock now, which
// is wrong here whenever --today is not today: pin it to the end of our fictional TODAY instead.
const EOD_TODAY = ts(TODAY, 23, 59);
function balanceToday(accountId: string): number { return accountBalanceMinor(db, accountId, { includePending: true, now: EOD_TODAY }); }

const periodEndExclusive = addPeriod(TODAY, "daily", 1);
const rows = budgetRows(db, { start: PERIOD_START, end: periodEndExclusive, budgetAccount: main.id });
assertTrue(rows.length === budgetSpecs.length, `expected ${budgetSpecs.length} budget rows, got ${rows.length}`);
for (const r of rows) {
  assertTrue(Number.isFinite(r.spent_minor) && !Number.isNaN(r.spent_minor), `NaN spend for budget ${r.budget.category_id}`);
  const ratio = r.spent_minor / r.budget.amount_minor;
  const isCoffee = r.budget.category_id === catCoffee.id;
  assertTrue(isCoffee ? ratio > 1 && ratio < 1.4 : ratio >= 0.1 && ratio <= 1.0, `budget ${r.budget.category_id} ratio out of range: ${ratio.toFixed(2)}`);
}
const free = freeMoney(db, { start: PERIOD_START, end: periodEndExclusive, budgetAccount: main.id });
assertTrue(free.every((f) => Number.isFinite(f.minor)), "freeMoney produced NaN");

for (const b of listTrips(db)) {
  const stats = tripStats(db, b, { today: TODAY });
  assertTrue(Number.isFinite(stats.spent_minor) && !Number.isNaN(stats.spent_minor), `NaN trip spend for ${stats.name}`);
}
const debts = listDebts(db);
assertTrue(debts.length === 8, `expected 8 debts, got ${debts.length}`);
const totals = debtTotals(debts);
assertTrue(totals.every((t) => Number.isFinite(t.owed_to_me_minor) && Number.isFinite(t.i_owe_minor)), "debtTotals produced NaN");

for (const a of [main, cash, savings, revolut, joint]) {
  const bal = balanceToday(a.id);
  assertTrue(Number.isFinite(bal), `NaN balance for ${a.name}`);
}
assertTrue(Math.abs(balanceToday(savings.id) - toMinor(6400, "EUR")) < 1, `Savings should land on 6400.00 EUR, got ${fromMinor(balanceToday(savings.id), "EUR")}`);
assertTrue(Math.abs(balanceToday(revolut.id) - toMinor(900, "USD")) < 1, `Revolut should land on 900.00 USD, got ${fromMinor(balanceToday(revolut.id), "USD")}`);

// ---------------------------------------------------------------------------------------------
// Export + write
// ---------------------------------------------------------------------------------------------

const backup = exportBackup(db, { includeDeleted: false });
const outPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "screenshots", "demo", "kopiyka-demo.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(backup, null, 1));

console.log(outPath);
console.log(`  today=${TODAY}  period=${PERIOD_START}..${TODAY}`);
console.log(`  ${backup.accounts.length} accounts, ${backup.categories.length} categories, ${backup.tags.length} tags, ${backup.transactions.length} transactions, ${backup.recurring_rules.length} recurring rules, ${backup.budgets.length} budgets, ${backup.insights?.length ?? 0} insights, ${backup.debts?.length ?? 0} debts, ${backup.rates?.length ?? 0} rates`);
for (const a of listRows(db, "accounts", "deleted=0", [], "group_name, sort")) {
  console.log(`  ${a.group_name.padEnd(10)} ${a.name.padEnd(10)} ${fromMinor(balanceToday(a.id), a.currency).toFixed(2).padStart(12)} ${a.currency}`);
}
console.log("  budgets (current period):");
for (const r of rows) {
  const catName = allCats().find((c) => c.id === r.budget.category_id)?.name ?? "?";
  console.log(`    ${catName.padEnd(24)} ${formatMinor(r.spent_minor, "EUR")} / ${formatMinor(r.budget.amount_minor, "EUR")} EUR (${((r.spent_minor / r.budget.amount_minor) * 100).toFixed(0)}%)`);
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
