/**
 * The demo dataset itself: a Lisbon persona in EUR for English, a Kyiv persona in UAH for Ukrainian —
 * about 5 months of history, budgets sitting mid-range, a running trip and a finished one, debts,
 * insights and cached exchange rates. Written into whatever database it is handed, through the
 * core API only, so it runs anywhere core does: the screenshot CLI (demo-data.ts, on Bun) and the
 * app itself (Settings → Load test data, development builds only — src/lib/demo.ts).
 *
 * Deterministic: a small seeded PRNG over `today`, so the same day always builds the same data.
 * Nothing here reads any personal export — it is entirely invented. Words come from the `demo`
 * namespace (packages/i18n/locales/<lang>/demo.json → ./i18n/<lang>.json, passed in as `messages`);
 * amounts, coordinates and the time zone are the `PROFILES` below.
 */
import {
  migrate, setMeta, setHome,
  createAccount, createCategory, createTag, createTransaction, createRecurring, createBudget, createInsight, createDebt, createTransfer,
  listRows, accountBalanceMinor, toMinor, fromMinor, addPeriod, budgetPeriod,
  seedCategories, COLORS,
  startTrip, endTrip, tripStats, listTrips,
  listDebts, debtTotals, settleDebt,
  budgetRows, freeMoney, templateFromTransaction,
  type Account, type Category, type Transaction, type RecurringRule, type SqlDriver,
} from "@kopiyka/core";

// ---------------------------------------------------------------------------------------------
// Per-language numbers. Amounts are major units of the profile's currency (`card` is the US-dollar
// card's); a shop is [lat, lon, min, max]. Text for every one of these lives in the demo namespace.
// ---------------------------------------------------------------------------------------------

type Shop = readonly [lat: number, lon: number, min: number, max: number];
const SHOP_SLOTS = ["groceries1", "groceries2", "groceries3", "groceries4", "coffee1", "coffee2", "lunch1", "lunch2", "dinner1", "dinner2", "dinner3",
  "taxi1", "taxi2", "metro", "fuel", "clothes", "electronics", "hobbies", "furniture", "household", "pharmacy", "cinema", "presents1", "presents2", "kids1", "kids2"] as const;
type ShopSlot = (typeof SHOP_SLOTS)[number];
interface Group { target: number; ratio: number; count: number; range: [number, number] }
interface Profile {
  currency: string;
  /** Standard and summer UTC offsets in minutes; both cities change on the EU's last Sundays. */
  tz: [number, number];
  home: { lat: number; lon: number };
  shops: Record<ShopSlot, Shop>;
  mainOpening: number; cashTarget: number; jointTarget: number;
  savingsTarget: number; savingsMonthly: number; goal: number;
  weekly: { classes: number; padel: number };
  budgets: { groceries: number; restaurants: number; coffee: number; transport: number; entertainment: number; shopping: number; household: number };
  groups: { groceries: Group; restaurants: Group; coffee: Group; taxi: Group; metro: Group; fuel: Group; entertainment: Group; household: Group; clothes: Group; electronics: Group; hobbies: Group };
  padding: { pharmacy: number; presents: number; kids: number };
  pastTrip: { budget: number; hotel: number; dinner: number; museum: number; metro: number };
  trip: { budget: number; train: number; hotel: number; dinner: number; tasting: number; dinner2: number; lunch: number; extra: number | null };
  joint: { groceries: number; household: number };
  rules: { rent: number; icloud: number; spotify: number; netflix: number; gym: number; phone: number; energy: number; salary: number; carInsurance: number };
  pending: number;
  debts: [number, number, number, number, number, number, number, number];
  /** Rates written for every day the card was used, and for today only. */
  rates: { daily: [string, string, number][]; today: [string, string, number][] };
  /** Entries only this language shows, placed where the screenshots catch them. */
  extras: { trousers: number; chocolate: number; gambler: number; teeth: number } | null;
}

const PROFILES: Record<string, Profile> = {
  en: {
    currency: "EUR", tz: [0, 60], home: { lat: 38.7223, lon: -9.1393 },
    shops: {
      groceries1: [38.7223, -9.145, 12, 55], groceries2: [38.7278, -9.1352, 18, 75], groceries3: [38.7057, -9.1774, 10, 45], groceries4: [38.7069, -9.1459, 8, 30],
      coffee1: [38.7145, -9.1394, 2.2, 4.8], coffee2: [38.7107, -9.1427, 1.2, 3.6],
      lunch1: [38.7069, -9.1459, 9, 18], lunch2: [38.7223, -9.135, 12, 26],
      dinner1: [38.7069, -9.1459, 16, 32], dinner2: [38.7223, -9.135, 20, 45], dinner3: [38.7107, -9.1427, 14, 28],
      taxi1: [38.7167, -9.1395, 4.5, 13], taxi2: [38.7167, -9.1395, 4, 12], metro: [38.7107, -9.1396, 1.65, 6.4], fuel: [38.735, -9.15, 42, 62],
      clothes: [38.7106, -9.1421, 18, 65], electronics: [38.7106, -9.1419, 15, 90], hobbies: [38.7227, -9.1608, 12, 60],
      furniture: [38.7495, -9.2258, 25, 140], household: [38.7495, -9.2258, 8, 45], pharmacy: [38.7139, -9.1387, 4, 22], cinema: [38.7211, -9.1467, 8.5, 12.5],
      presents1: [38.711, -9.142, 15, 40], presents2: [38.7107, -9.1418, 12, 35], kids1: [38.7108, -9.1423, 15, 45], kids2: [38.7592, -9.1975, 18, 55],
    },
    mainOpening: 350.75, cashTarget: 150, jointTarget: 400, savingsTarget: 6400, savingsMonthly: 400, goal: 10000,
    weekly: { classes: 45, padel: 12 },
    budgets: { groceries: 450, restaurants: 220, coffee: 60, transport: 120, entertainment: 80, shopping: 250, household: 90 },
    groups: {
      groceries: { target: 450, ratio: 0.62, count: 6, range: [8, 50] },
      restaurants: { target: 220, ratio: 0.25, count: 6, range: [9, 35] },
      coffee: { target: 60, ratio: 1.08, count: 14, range: [1.5, 5] },
      taxi: { target: 120, ratio: 0.3, count: 5, range: [4, 14] },
      metro: { target: 120, ratio: 0.15, count: 4, range: [1.5, 6] },
      fuel: { target: 120, ratio: 0.05, count: 1, range: [40, 60] },
      entertainment: { target: 80, ratio: 0.45, count: 3, range: [8, 13] },
      household: { target: 90, ratio: 0.5, count: 3, range: [8, 45] },
      clothes: { target: 55, ratio: 0.4, count: 1, range: [15, 65] },
      electronics: { target: 55, ratio: 0.35, count: 1, range: [15, 90] },
      hobbies: { target: 55, ratio: 0.25, count: 1, range: [10, 60] },
    },
    padding: { pharmacy: 9.9, presents: 28, kids: 32 },
    pastTrip: { budget: 800, hotel: 140, dinner: 34, museum: 15, metro: 9.5 },
    trip: { budget: 600, train: 32.6, hotel: 189, dinner: 38, tasting: 11, dinner2: 41, lunch: 14.5, extra: null },
    joint: { groceries: 64.5, household: 118 },
    rules: { rent: -1250, icloud: -2.99, spotify: -10.99, netflix: -15.99, gym: -39.9, phone: -29.9, energy: -62, salary: 3850, carInsurance: -380 },
    pending: 7.4,
    debts: [120, 350, 45, 80, 25, 200, 60, 40],
    rates: { daily: [["USD", "EUR", 0.92], ["EUR", "USD", 1.087]], today: [["EUR", "PLN", 4.28]] },
    extras: null,
  },
  uk: {
    currency: "UAH", tz: [120, 180], home: { lat: 50.4501, lon: 30.5234 },
    shops: {
      groceries1: [50.4385, 30.516, 300, 1500], groceries2: [50.441, 30.505, 200, 900], groceries3: [50.465, 30.515, 350, 1400], groceries4: [50.442, 30.521, 150, 600],
      coffee1: [50.4475, 30.523, 60, 90], coffee2: [50.45, 30.51, 75, 150],
      lunch1: [50.44, 30.52, 180, 360], lunch2: [50.446, 30.513, 350, 700],
      dinner1: [50.44, 30.52, 300, 600], dinner2: [50.446, 30.513, 500, 1100], dinner3: [50.45, 30.524, 600, 1400],
      taxi1: [50.4501, 30.5234, 120, 350], taxi2: [50.4501, 30.5234, 110, 330], metro: [50.447, 30.522, 8, 40], fuel: [50.46, 30.44, 1500, 2400],
      clothes: [50.4385, 30.522, 900, 3500], electronics: [50.427, 30.556, 500, 4000], hobbies: [50.388, 30.484, 400, 2500],
      furniture: [50.487, 30.495, 900, 5000], household: [50.438, 30.517, 150, 800], pharmacy: [50.448, 30.523, 150, 800], cinema: [50.4385, 30.522, 200, 350],
      presents1: [50.45, 30.51, 400, 1200], presents2: [50.447, 30.513, 300, 900], kids1: [50.412, 30.522, 400, 1500], kids2: [50.492, 30.365, 500, 1800],
    },
    mainOpening: 52350, cashTarget: 3000, jointTarget: 15000, savingsTarget: 180000, savingsMonthly: 8000, goal: 300000,
    weekly: { classes: 900, padel: 500 },
    budgets: { groceries: 15000, restaurants: 7000, coffee: 2000, transport: 5000, entertainment: 2000, shopping: 10000, household: 3000 },
    groups: {
      groceries: { target: 15000, ratio: 0.62, count: 6, range: [300, 1500] },
      restaurants: { target: 7000, ratio: 0.25, count: 6, range: [180, 900] },
      coffee: { target: 2000, ratio: 1.08, count: 14, range: [60, 150] },
      taxi: { target: 5000, ratio: 0.3, count: 5, range: [120, 350] },
      metro: { target: 5000, ratio: 0.03, count: 4, range: [8, 60] },
      fuel: { target: 5000, ratio: 0.3, count: 1, range: [1500, 2400] },
      entertainment: { target: 2000, ratio: 0.45, count: 3, range: [200, 350] },
      household: { target: 3000, ratio: 0.5, count: 3, range: [150, 800] },
      clothes: { target: 3000, ratio: 0.4, count: 1, range: [900, 3500] },
      electronics: { target: 3000, ratio: 0.35, count: 1, range: [500, 4000] },
      hobbies: { target: 3000, ratio: 0.25, count: 1, range: [400, 2500] },
    },
    padding: { pharmacy: 349, presents: 650, kids: 890 },
    pastTrip: { budget: 12000, hotel: 3200, dinner: 950, museum: 300, metro: 30 },
    trip: { budget: 15000, train: 1250, hotel: 5400, dinner: 850, tasting: 150, dinner2: 980, lunch: 280, extra: 35 },
    joint: { groceries: 1450, household: 2300 },
    rules: { rent: -18000, icloud: -39, spotify: -149, netflix: -299, gym: -1200, phone: -250, energy: -2400, salary: 55000, carInsurance: -2600 },
    pending: 186,
    debts: [3500, 12000, 45, 1600, 600, 4500, 1500, 900],
    rates: { daily: [["USD", "UAH", 41.3], ["UAH", "USD", 0.0242]], today: [["EUR", "UAH", 48.2]] },
    extras: { trousers: 40, chocolate: 45, gambler: 1350, teeth: 2800 },
  },
};

export interface DemoOptions {
  lang: string;
  /** YYYY-MM-DD: the day the data is built around. */
  today: string;
  /** The compiled `demo.*` messages for `lang` (./i18n/<lang>.json). */
  messages: Record<string, string>;
  /** Deterministic row ids, for the screenshot pipeline's deep links. Replaces crypto.randomUUID from then on. */
  stableIds?: boolean;
}

/** Languages there is a demo persona for. */
export const DEMO_LANGUAGES = Object.keys(PROFILES);

/** Build the whole dataset into `db` (an empty database; it is migrated here), validating it on the way. */
export function buildDemo(db: SqlDriver, opts: DemoOptions) {
  const LANG = opts.lang;
  const TODAY = opts.today;
  const MESSAGES = opts.messages;
  /** A `demo.*` message in this language. Missing text is an error, never an English fallback. */
  function m(key: string): string {
    const v = MESSAGES[`demo.${key}`];
    if (v === undefined) throw new Error(`demo text missing: demo.${key} (${LANG}) — add it to packages/i18n/locales/${LANG}/demo.json and run bun run i18n`);
    return v;
  }

  const found = PROFILES[LANG];
  if (!found) throw new Error(`no demo profile for "${LANG}" — add one to PROFILES in demo-build.ts (there are ${Object.keys(PROFILES).join(", ")})`);
  // Typed outright: a narrowed `const` is not narrowed inside the hoisted functions below.
  const P: Profile = found;
  const CUR = P.currency;
  const CARD = "USD";

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
  // English keeps the seeds it always had, so its dataset is unchanged; other languages get their own.
  const SEED_SUFFIX = LANG === "en" ? "" : `-${LANG}`;
  const rand = mulberry32(seedFromString(`kopiyka-demo-${TODAY}${SEED_SUFFIX}`));

  // Row ids too: @kopiyka/core's newId() calls crypto.randomUUID, which would hand out fresh ids on
  // every run. capture.sh reads ids (the Restaurants category, the trip tag) out of the written JSON
  // and puts them in deep links, so a JSON regenerated after the simulator was seeded used to point
  // at rows that are not in the simulator's database — the entry sheet then opened with no category
  // and the trip filter matched nothing. A separate stream keeps `rand` above untouched. Only for the
  // CLI (`stableIds`): it replaces crypto.randomUUID from then on.
  if (opts.stableIds) {
    const idRand = mulberry32(seedFromString(`kopiyka-demo-ids-${TODAY}${SEED_SUFFIX}`));
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
  // Date / time helpers. Dates are YYYY-MM-DD; timestamps get the persona's real DST offset (Lisbon
  // WET/WEST, Kyiv EET/EEST — both switch on the EU's last Sundays of March and October) computed
  // from the date, not the machine running the script, so the file is reproducible.
  // ---------------------------------------------------------------------------------------------

  function lastSundayUTC(year: number, month1to12: number): Date {
    const last = new Date(Date.UTC(year, month1to12, 0)); // last day of that month
    last.setUTCDate(last.getUTCDate() - last.getUTCDay());
    return last;
  }
  function offsetMinutes(day: string): number {
    const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
    const noon = new Date(Date.UTC(y, mo - 1, d, 12));
    const marchChange = lastSundayUTC(y, 3), octChange = lastSundayUTC(y, 10);
    return noon >= marchChange && noon < octChange ? P.tz[1] : P.tz[0];
  }
  function ts(day: string, hh: number, mm: number): string {
    const off = offsetMinutes(day);
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

  migrate(db);

  // The app's own ready-made categories, named in this language; found again by their preset key
  // (DATA.md rule 16), never by a name that changes with the language.
  seedCategories(db, LANG);
  const allCats = () => listRows(db, "categories", "deleted=0");
  function preset(key: string): Category {
    const c = allCats().find((c) => c.preset === key);
    if (!c) throw new Error(`preset category not found: ${key}`);
    return c;
  }

  const fShopping = preset("shopping"), fTransport = preset("transport");
  const fHealth = preset("health"), fPersonal = preset("personal"), fFamily = preset("family");

  const catGroceries = preset("food.groceries");
  const catRestaurants = preset("food.restaurants");
  const catCoffee = preset("food.coffee");
  const catClothes = preset("shopping.clothes");
  const catElectronics = preset("shopping.electronics");
  const catHousehold = preset("shopping.household");
  const catWishes = preset("shopping.wishes");
  const catRent = preset("home.rent");
  const catUtilities = preset("home.utilities");
  const catInternet = preset("home.internet");
  const catFurniture = preset("home.furniture");
  const catCar = preset("transport.car");
  const catFuel = preset("transport.fuel");
  const catPublicTransport = preset("transport.publicTransport");
  const catTaxi = preset("transport.taxi");
  const catPharmacy = preset("health.pharmacy");
  const catDoctor = preset("health.doctor");
  const catGym = preset("health.gym");
  const catSubscriptions = preset("bills.subscriptions");
  const catEntertainment = preset("fun.entertainment");
  const catTravel = preset("fun.travel");
  const catPresents = preset("fun.presents");
  const catKids = preset("family.kids");
  const catSalary = preset("income.salary");
  const catHobbies = preset("personal.hobbies");

  // A couple of custom categories beyond the preset (per DATA.md rule 5, plain categories, not folders).
  const catPortuguese = createCategory(db, { name: m("category.classes.name"), parent_id: fPersonal.id, icon: "graduationcap.fill", color: fPersonal.color, kind: "expense", description: m("category.classes.description") });
  const catPadel = createCategory(db, { name: m("category.padel.name"), parent_id: fHealth.id, icon: "tennis.racket", color: fHealth.color, kind: "expense", description: m("category.padel.description") });

  const tagLunch = createTag(db, { name: m("tag.lunch"), color: colorByName("orange"), category_ids: JSON.stringify([catRestaurants.id]) });
  const tagWork = createTag(db, { name: m("tag.work"), color: colorByName("blue") });
  const tagWeekend = createTag(db, { name: m("tag.weekend"), color: colorByName("green") });
  const tagGift = createTag(db, { name: m("tag.gift"), color: colorByName("pink") });
  const tagKids = createTag(db, { name: m("tag.kids"), color: colorByName("amber"), category_ids: JSON.stringify([fFamily.id]) });
  const tagCoffee = createTag(db, { name: m("tag.coffee"), color: colorByName("brown") });

  // ---------------------------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------------------------

  // The 6 purchases on the US-dollar card are fixed amounts (in every language) so the opening
  // balance can be computed exactly to land the account at ~900 USD today, per the brief.
  const revolutTx: { date: string; hh: number; amount: number; payee: string; category: Category; place?: string; lat?: number; lon?: number }[] = [
    { date: addPeriod(TODAY, "monthly", -4), hh: 9, amount: -2.99, payee: m("card.apple"), category: catSubscriptions },
    { date: addPeriod(TODAY, "monthly", -3), hh: 21, amount: -34.5, payee: m("card.amazon"), category: catElectronics },
    { date: addPeriod(TODAY, "monthly", -2), hh: 10, amount: -12.99, payee: m("card.adobe"), category: catSubscriptions },
    { date: addPeriod(TODAY, "monthly", -1), hh: 20, amount: -0.99, payee: m("card.apple"), category: catSubscriptions },
    { date: addPeriod(TODAY, "daily", -18), hh: 16, amount: -58.2, payee: m("card.amazon"), category: catWishes },
    { date: addPeriod(TODAY, "daily", -6), hh: 22, amount: -9.99, payee: m("card.apple"), category: catSubscriptions },
  ];
  const revolutTotalMinor = revolutTx.reduce((a, t) => a + toMinor(t.amount, CARD), 0);
  const revolutOpening = toMinor(900, CARD) - revolutTotalMinor;

  // Monthly Main -> Savings transfers (400 EUR in English) on the 26th, back to well before HISTORY_START; only
  // the ones inside the demo window are actually posted, but all of them count towards "today's"
  // Savings balance, which is why the opening balance is computed from all of them.
  const { past: allTransferDays } = occurrencesUpTo("2022-01-26", "monthly", TODAY);
  const postedTransferDays = allTransferDays.filter((d) => d >= HISTORY_START);
  // Only the transfers actually posted (inside the demo window) move the balance we can see; the
  // opening balance stands in for everything before that, so it is target minus just those.
  const savingsOpening = toMinor(P.savingsTarget, CUR) - postedTransferDays.length * toMinor(P.savingsMonthly, CUR);

  const main = createAccount(db, { name: m("account.main"), currency: CUR, type: "bank", icon: "building.columns.fill", color: colorByName("blue"), opening_balance_minor: toMinor(P.mainOpening, CUR), sort: 0 });
  const savings = createAccount(db, { name: m("account.savings"), currency: CUR, type: "savings", icon: "leaf.fill", color: colorByName("teal"), opening_balance_minor: savingsOpening, sort: 2 });
  const revolut = createAccount(db, { name: m("account.card"), currency: CARD, type: "card", icon: "creditcard.fill", color: colorByName("violet"), opening_balance_minor: revolutOpening, sort: 3 });
  // Cash and Joint are created further down, once every spec that spends from them exists — their
  // opening balance is computed backwards from that total so today's balance lands somewhere sane.

  setMeta(db, "current_account", main.id);
  setMeta(db, "budget_scope", main.id);
  setMeta(db, "base_currency", CUR);
  setMeta(db, "period_start_day", String(PERIOD_START_DAY));
  setMeta(db, "location_enabled", "1");
  setHome(db, { lat: P.home.lat, lon: P.home.lon, place: m("home") });
  setMeta(db, "show_balance", "1");
  // The app's language (DATA.md rule 7): it travels in the exported file's settings, so --apply and an
  // import on a real phone both open the app in the language the data was written in.
  setMeta(db, "language", LANG);

  // ---------------------------------------------------------------------------------------------
  // Merchants (name, category, place, coordinates repeated per merchant so suggestCategoryNear
  // would find them, amount range in the account's own currency).
  // ---------------------------------------------------------------------------------------------

  interface Merchant { name: string; category: Category; place: string; lat: number; lon: number; min: number; max: number }
  /** A shop slot as this language has it: name and place from the demo namespace, the rest from P. */
  function shop(slot: ShopSlot, category: Category): Merchant {
    const [lat, lon, min, max] = P.shops[slot];
    return { name: m(`shop.${slot}.name`), place: m(`shop.${slot}.place`), category, lat, lon, min, max };
  }
  const M = {
    groceries: [shop("groceries1", catGroceries), shop("groceries2", catGroceries), shop("groceries3", catGroceries), shop("groceries4", catGroceries)],
    coffee: [shop("coffee1", catCoffee), shop("coffee2", catCoffee)],
    lunch: [shop("lunch1", catRestaurants), shop("lunch2", catRestaurants)],
    dinner: [shop("dinner1", catRestaurants), shop("dinner2", catRestaurants), shop("dinner3", catRestaurants)],
    taxi: [shop("taxi1", catTaxi), shop("taxi2", catTaxi)],
    publicTransport: [shop("metro", catPublicTransport)],
    fuel: [shop("fuel", catFuel)],
    clothes: [shop("clothes", catClothes)],
    electronics: [shop("electronics", catElectronics)],
    hobbies: [shop("hobbies", catHobbies)],
    furniture: [shop("furniture", catFurniture)],
    pharmacy: [shop("pharmacy", catPharmacy)],
    entertainment: [shop("cinema", catEntertainment)],
    presents: [shop("presents1", catPresents), shop("presents2", catPresents)],
    kids: [shop("kids1", catKids), shop("kids2", catKids)],
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
    const s: TxSpec = { date: day, hh, mm: mmMin, amountMinor: toMinor(amount, account === "Revolut" ? CARD : CUR), currency: account === "Revolut" ? CARD : CUR, account, category: m.category, notes: m.name, tagIds: opts.tagIds ?? [] };
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
    // Weekly fixed activities: language classes on Tuesdays, padel on Wednesdays.
    weekly(day);
  }
  function weekly(day: string) {
    const dow = dayOfWeek(day);
    if (dow === 2) specs.push({ date: day, hh: 19, mm: 0, amountMinor: -toMinor(P.weekly.classes, CUR), currency: CUR, account: "Main", category: catPortuguese, notes: m("category.classes.name") });
    if (dow === 3) specs.push({ date: day, hh: 20, mm: 30, amountMinor: -toMinor(P.weekly.padel, CUR), currency: CUR, account: "Cash", category: catPadel, notes: m("category.padel.name") });
  }

  // -- A finished trip (Madrid in English): today-60 .. today-56 ----------------------------------
  const madridStart = addPeriod(TODAY, "daily", -60), madridEnd = addPeriod(TODAY, "daily", -56);
  const { budget: madridBudget, tag: madridTag } = startTrip(db, { name: m("trip.past.name"), currency: CUR, amount_minor: toMinor(P.pastTrip.budget, CUR), starts: madridStart, ends: madridEnd });
  endTrip(db, madridBudget.id, madridEnd);
  const madridRows: TxSpec[] = [
    { date: madridStart, hh: 15, mm: 0, amountMinor: -toMinor(P.pastTrip.hotel, CUR), currency: CUR, account: "Main", category: catTravel, notes: m("trip.past.hotel"), tagIds: [madridTag.id] },
    { date: madridStart, hh: 21, mm: 0, amountMinor: -toMinor(P.pastTrip.dinner, CUR), currency: CUR, account: "Cash", category: catRestaurants, notes: m("trip.past.dinner"), tagIds: [madridTag.id] },
    { date: addPeriod(madridStart, "daily", 1), hh: 16, mm: 0, amountMinor: -toMinor(P.pastTrip.museum, CUR), currency: CUR, account: "Cash", category: catEntertainment, notes: m("trip.past.museum"), tagIds: [madridTag.id] },
    { date: addPeriod(madridStart, "daily", 1), hh: 12, mm: 0, amountMinor: -toMinor(P.pastTrip.metro, CUR), currency: CUR, account: "Cash", category: catPublicTransport, notes: m("trip.past.metro"), tagIds: [madridTag.id] },
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
      const s: TxSpec = { date: day, hh: hour, mm: randInt(0, 55), amountMinor: -amt, currency: CUR, account: pick(acct), category: m.category, notes: m.name, tagIds: tagFor ? tagFor(day) : [] };
      if (chance(0.4)) { s.lat = m.lat; s.lon = m.lon; s.place = m.place; }
      specs.push(s);
    }
  }

  /** A budget group's target in minor units: so much of the budget it is measured against. */
  const G = (g: Group) => Math.round(toMinor(g.target, CUR) * g.ratio);
  const R = P.groups;
  // Groceries ~62%; Restaurants & cafés ~25%; Coffee & snacks ~108% (slightly over).
  budgetedGroup(M.groceries, G(R.groceries), R.groceries.count, [11, 19], ["Main", "Main", "Cash"], R.groceries.range);
  budgetedGroup([...M.lunch, ...M.dinner], G(R.restaurants), R.restaurants.count, [13, 21], ["Main"], R.restaurants.range, (day) => (isWeekend(day) ? [tagWeekend.id] : chance(0.6) ? [tagLunch.id] : []));
  budgetedGroup(M.coffee, G(R.coffee), R.coffee.count, [8, 17], ["Main", "Cash"], R.coffee.range, () => (chance(0.5) ? [tagCoffee.id] : []));

  // Transport folder ~50%, spread across taxi/public transport/fuel.
  budgetedGroup(M.taxi, G(R.taxi), R.taxi.count, [18, 23], ["Cash", "Main"], R.taxi.range);
  budgetedGroup(M.publicTransport, G(R.metro), R.metro.count, [8, 19], ["Main"], R.metro.range);
  budgetedGroup(M.fuel, G(R.fuel), R.fuel.count, [17, 18], ["Main"], R.fuel.range);

  // Entertainment ~45%.
  budgetedGroup(M.entertainment, G(R.entertainment), R.entertainment.count, [20, 22], ["Cash", "Main"], R.entertainment.range, (day) => (isWeekend(day) ? [tagWeekend.id] : []));

  // Household ~50% (its own budget); the Shopping folder lands well under its limit, Household's share included.
  const householdMerchant: Merchant = shop("household", catHousehold);
  budgetedGroup([householdMerchant], G(R.household), R.household.count, [17, 19], ["Main"], R.household.range);
  budgetedGroup(M.clothes, G(R.clothes), R.clothes.count, [17, 19], ["Main"], R.clothes.range);
  budgetedGroup(M.electronics, G(R.electronics), R.electronics.count, [17, 19], ["Main"], R.electronics.range);
  budgetedGroup(M.hobbies, G(R.hobbies), R.hobbies.count, [17, 19], ["Main"], R.hobbies.range);

  // A little unbudgeted padding: pharmacy, presents, kids, weekly classes, transfer and Revolut rows already add up.
  specs.push({ date: periodDay(), hh: 18, mm: 20, amountMinor: -toMinor(P.padding.pharmacy, CUR), currency: CUR, account: "Main", category: catPharmacy, notes: m("shop.pharmacy.name") });
  specs.push({ date: periodDay(), hh: 18, mm: 40, amountMinor: -toMinor(P.padding.presents, CUR), currency: CUR, account: "Main", category: catPresents, notes: m("shop.presents2.name"), tagIds: [tagGift.id] });
  specs.push({ date: periodDay(), hh: 17, mm: 10, amountMinor: -toMinor(P.padding.kids, CUR), currency: CUR, account: "Main", category: catKids, notes: m("shop.kids1.name"), tagIds: [tagKids.id] });
  for (const day of periodDays) weekly(day);

  // -- Entries only some languages show (the Ukrainian set's, asked for word for word) -------------
  // The last minutes of today, so they sit at the very top of the transaction list whatever the
  // random rows land on; the dentist comes after the chocolate.
  if (P.extras) {
    const x = P.extras;
    specs.push({ date: TODAY, hh: 23, mm: 56, amountMinor: -toMinor(x.chocolate, CUR), currency: CUR, account: "Cash", category: catCoffee, notes: m("extra.chocolate") });
    specs.push({ date: TODAY, hh: 23, mm: 57, amountMinor: -toMinor(x.trousers, CUR), currency: CUR, account: "Cash", category: catClothes, notes: m("extra.trousers") });
    specs.push({ date: TODAY, hh: 23, mm: 58, amountMinor: -toMinor(x.gambler, CUR), currency: CUR, account: "Main", category: catWishes, notes: m("extra.gambler") });
    specs.push({ date: TODAY, hh: 23, mm: 59, amountMinor: -toMinor(x.teeth, CUR), currency: CUR, account: "Main", category: catDoctor, notes: m("extra.teeth") });
  }

  // -- The active trip (Porto weekend in English): today-2 .. today+2 -----------------------------
  const portoStart = addPeriod(TODAY, "daily", -2), portoEnd = addPeriod(TODAY, "daily", 2);
  const T = P.trip;
  const { tag: portoTag } = startTrip(db, { name: m("trip.current.name"), currency: CUR, amount_minor: toMinor(T.budget, CUR), starts: portoStart, ends: portoEnd });
  const portoRows: TxSpec[] = [
    { date: portoStart, hh: 12, mm: 0, amountMinor: -toMinor(T.train, CUR), currency: CUR, account: "Main", category: catPublicTransport, notes: m("trip.current.train"), tagIds: [portoTag.id] },
    { date: portoStart, hh: 16, mm: 0, amountMinor: -toMinor(T.hotel, CUR), currency: CUR, account: "Main", category: catTravel, notes: m("trip.current.hotel"), tagIds: [portoTag.id] },
    { date: portoStart, hh: 20, mm: 30, amountMinor: -toMinor(T.dinner, CUR), currency: CUR, account: "Cash", category: catRestaurants, notes: m("trip.current.dinner"), tagIds: [portoTag.id] },
    { date: YESTERDAY, hh: 19, mm: 0, amountMinor: -toMinor(T.tasting, CUR), currency: CUR, account: "Cash", category: catEntertainment, notes: m("trip.current.tasting"), tagIds: [portoTag.id] },
    { date: YESTERDAY, hh: 21, mm: 0, amountMinor: -toMinor(T.dinner2, CUR), currency: CUR, account: "Cash", category: catRestaurants, notes: m("trip.current.dinner"), tagIds: [portoTag.id] },
    { date: TODAY, hh: 13, mm: 30, amountMinor: -toMinor(T.lunch, CUR), currency: CUR, account: "Cash", category: catRestaurants, notes: m("trip.current.lunch"), tagIds: [portoTag.id] },
  ];
  if (T.extra !== null) portoRows.push({ date: TODAY, hh: 15, mm: 10, amountMinor: -toMinor(T.extra, CUR), currency: CUR, account: "Cash", category: catCoffee, notes: m("trip.current.extra"), tagIds: [portoTag.id] });
  specs.push(...portoRows);

  // -- Revolut (USD) purchases ----------------------------------------------------------------------
  for (const t of revolutTx) specs.push({ date: t.date, hh: t.hh, mm: randInt(0, 55), amountMinor: toMinor(t.amount, CARD), currency: CARD, account: "Revolut", category: t.category, notes: t.payee });

  // -- Joint (the one or two shared-account rows) --------------------------------------------------
  specs.push({ date: addPeriod(TODAY, "monthly", -3), hh: 11, mm: 0, amountMinor: -toMinor(P.joint.groceries, CUR), currency: CUR, account: "Joint", category: catGroceries, notes: m("shop.groceries2.name") });
  specs.push({ date: addPeriod(TODAY, "monthly", -2), hh: 17, mm: 0, amountMinor: -toMinor(P.joint.household, CUR), currency: CUR, account: "Joint", category: catHousehold, notes: m("shop.household.name") });

  // Cash and Joint: opening balance computed backwards from every spec that spends from them, so
  // today's balance lands on a sane, positive number instead of drifting wherever chance took it.
  const cashSpentMinor = specs.filter((s) => s.account === "Cash").reduce((a, s) => a + s.amountMinor, 0);
  const jointSpentMinor = specs.filter((s) => s.account === "Joint").reduce((a, s) => a + s.amountMinor, 0);
  const cash = createAccount(db, { name: m("account.cash"), currency: CUR, type: "cash", icon: "banknote.fill", color: colorByName("green"), opening_balance_minor: toMinor(P.cashTarget, CUR) - cashSpentMinor, sort: 1 });
  const joint = createAccount(db, { name: m("account.joint"), currency: CUR, type: "bank", group_name: m("account.group"), icon: "person.2.fill", color: colorByName("indigo"), opening_balance_minor: toMinor(P.jointTarget, CUR) - jointSpentMinor, sort: 0 });

  // ---------------------------------------------------------------------------------------------
  // Recurring rules + their historic postings
  // ---------------------------------------------------------------------------------------------

  const accountOf: Record<Acct, Account> = { Main: main, Cash: cash, Revolut: revolut, Joint: joint };

  interface RuleSpec { key: keyof Profile["rules"]; name: string; day: number; amount: number; category: Category; autoPost: 0 | 1; freq: "monthly" | "yearly"; time: string; anchor: string }
  const rule = (key: RuleSpec["key"], rest: Omit<RuleSpec, "key" | "name" | "amount">): RuleSpec => ({ key, name: m(`rule.${key}`), amount: P.rules[key], ...rest });
  const ruleSpecs: RuleSpec[] = [
    rule("rent", { day: 1, category: catRent, autoPost: 0, freq: "monthly", time: "09:00", anchor: "2023-01-01" }),
    rule("icloud", { day: 3, category: catSubscriptions, autoPost: 1, freq: "monthly", time: "00:05", anchor: "2023-01-03" }),
    rule("spotify", { day: 5, category: catSubscriptions, autoPost: 1, freq: "monthly", time: "09:15", anchor: "2023-01-05" }),
    rule("netflix", { day: 8, category: catSubscriptions, autoPost: 1, freq: "monthly", time: "10:30", anchor: "2023-01-08" }),
    rule("gym", { day: 10, category: catGym, autoPost: 1, freq: "monthly", time: "07:00", anchor: "2023-01-10" }),
    rule("phone", { day: 12, category: catInternet, autoPost: 1, freq: "monthly", time: "09:00", anchor: "2023-01-12" }),
    rule("energy", { day: 18, category: catUtilities, autoPost: 0, freq: "monthly", time: "09:00", anchor: "2023-01-18" }),
    rule("salary", { day: 25, category: catSalary, autoPost: 1, freq: "monthly", time: "09:00", anchor: "2023-01-25" }),
  ];
  const CAR_INSURANCE_ANCHOR = "2022-11-05"; // yearly, no occurrence inside the demo window

  const rules: RecurringRule[] = [];
  const templatesByKey = new Map<string, Transaction>();

  for (const rs of ruleSpecs) {
    const startDate = rs.anchor;
    const { past, next } = occurrencesUpTo(startDate, "monthly", TODAY);
    const rule = createRecurring(db, {
      account_id: main.id, amount_minor: toMinor(rs.amount, CUR), category_id: rs.category.id, payee: rs.name,
      frequency: "monthly", interval: 1, start_date: startDate, next_date: next, notify: 1, notify_days_before: 1,
      auto_post: rs.autoPost, active: 1, time_of_day: rs.time,
    });
    rules.push(rule);
    for (const day of past.filter((d) => d >= HISTORY_START)) {
      const tx = createTransaction(db, { account_id: main.id, date: ts(day, ...timeParts(rs.time)), amount_minor: toMinor(rs.amount, CUR), category_id: rs.category.id, payee: rs.name, recurring_id: rule.id });
      templatesByKey.set(rs.key, tx);
    }
  }
  const carInsurance = createRecurring(db, {
    account_id: main.id, amount_minor: toMinor(P.rules.carInsurance, CUR), category_id: catCar.id, payee: m("rule.carInsurance"),
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
    createTransfer(db, { from_account_id: main.id, to_account_id: savings.id, date: ts(day, 10, 0), from_amount_minor: toMinor(P.savingsMonthly, CUR), to_amount_minor: toMinor(P.savingsMonthly, CUR), from_currency: CUR, to_currency: CUR, notes: m("transfer") });
  }

  // The one pending row Shortcuts is meant to demonstrate.
  createTransaction(db, { account_id: main.id, date: ts(TODAY, 20, 5), amount_minor: -toMinor(P.pending, CUR), category_id: catTaxi.id, notes: m("shop.taxi2.name"), pending: 1, source: "shortcut-guess" });

  // ---------------------------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------------------------

  const PB = P.budgets;
  const budgetSpecs: { category: Category; amount: number }[] = [
    { category: catGroceries, amount: PB.groceries }, { category: catRestaurants, amount: PB.restaurants }, { category: catCoffee, amount: PB.coffee },
    { category: fTransport, amount: PB.transport }, { category: catEntertainment, amount: PB.entertainment }, { category: fShopping, amount: PB.shopping }, { category: catHousehold, amount: PB.household },
  ];
  for (const b of budgetSpecs) createBudget(db, { category_id: b.category.id, currency: CUR, amount_minor: toMinor(b.amount, CUR), period: "monthly", starts: PERIOD_START, start_day: PERIOD_START_DAY, account_id: main.id });

  // ---------------------------------------------------------------------------------------------
  // Debts
  // ---------------------------------------------------------------------------------------------

  // Open debts first (the Debts screen lists them newest-due first), then two settled ones for history.
  const D = P.debts;
  createDebt(db, { person: m("debt.d1.person"), direction: "owed_to_me", amount_minor: toMinor(D[0], CUR), currency: CUR, account_id: main.id, opened_date: addPeriod(TODAY, "daily", -9), due_date: addPeriod(TODAY, "daily", 5), notes: m("debt.d1.note"), notify: 1 });
  createDebt(db, { person: m("debt.d2.person"), direction: "i_owe", amount_minor: toMinor(D[1], CUR), currency: CUR, opened_date: addPeriod(TODAY, "daily", -20), due_date: addPeriod(TODAY, "daily", 12), notes: m("debt.d2.note") });
  createDebt(db, { person: m("debt.d3.person"), direction: "owed_to_me", amount_minor: toMinor(D[2], CARD), currency: CARD, opened_date: addPeriod(TODAY, "daily", -40), due_date: null, notes: m("debt.d3.note") });
  createDebt(db, { person: m("debt.d4.person"), direction: "owed_to_me", amount_minor: toMinor(D[3], CUR), currency: CUR, account_id: main.id, opened_date: addPeriod(TODAY, "daily", -6), due_date: addPeriod(TODAY, "daily", 20), notes: m("debt.d4.note"), notify: 1 });
  createDebt(db, { person: m("debt.d5.person"), direction: "i_owe", amount_minor: toMinor(D[4], CUR), currency: CUR, opened_date: addPeriod(TODAY, "daily", -3), due_date: null, notes: m("debt.d5.note") });
  createDebt(db, { person: m("debt.d6.person"), direction: "owed_to_me", amount_minor: toMinor(D[5], CUR), currency: CUR, opened_date: addPeriod(TODAY, "daily", -15), due_date: addPeriod(TODAY, "daily", -2), notes: m("debt.d6.note"), notify: 1 }); // overdue
  const pusik = createDebt(db, { person: m("debt.d7.person"), direction: "owed_to_me", amount_minor: toMinor(D[6], CUR), currency: CUR, opened_date: addPeriod(TODAY, "daily", -50) });
  settleDebt(db, pusik.id, { day: addPeriod(TODAY, "daily", -30) });
  const siri = createDebt(db, { person: m("debt.d8.person"), direction: "i_owe", amount_minor: toMinor(D[7], CUR), currency: CUR, opened_date: addPeriod(TODAY, "daily", -35), notes: m("debt.d8.note") });
  settleDebt(db, siri.id, { day: addPeriod(TODAY, "daily", -21) });

  // ---------------------------------------------------------------------------------------------
  // Insights
  // ---------------------------------------------------------------------------------------------

  createInsight(db, { kind: "free_money", sort: 0 });
  createInsight(db, { kind: "days_to_salary", sort: 1 });
  createInsight(db, { kind: "savings_goal", sort: 2, params: JSON.stringify({ title: m("goal"), account_id: savings.id, target_minor: toMinor(P.goal, CUR) }) });
  createInsight(db, { kind: "checklist", sort: 3, params: JSON.stringify({ category_ids: [catRent.id, catUtilities.id, catInternet.id] }) });
  // Subscriptions per year counts every recurring expense unless told otherwise; rent, energy and
  // the car insurance are bills, and with them in the card shows a year's rent as "subscriptions".
  const ruleId = (key: RuleSpec["key"]) => rules[ruleSpecs.findIndex((r) => r.key === key)]!.id;
  createInsight(db, { kind: "subscriptions", sort: 4, params: JSON.stringify({ exclude_rule_ids: [ruleId("rent"), ruleId("energy"), carInsurance.id] }) });
  createInsight(db, { kind: "regular", sort: 5, params: JSON.stringify({ category_ids: [catGroceries.id], frequency: "weekly" }) });
  const gymTpl = templatesByKey.get("gym"), vodafoneTpl = templatesByKey.get("phone");
  if (gymTpl && vodafoneTpl) {
    createInsight(db, { kind: "upcoming", sort: 6, params: JSON.stringify({ templates: [templateFromTransaction(gymTpl), templateFromTransaction(vodafoneTpl)] }) });
  }

  // ---------------------------------------------------------------------------------------------
  // Exchange rates (offline demo: no network needed). Frankfurter convention: rate = quote per base.
  // ---------------------------------------------------------------------------------------------

  const rateDays = new Set<string>([TODAY, ...revolutTx.map((t) => t.date)]);
  for (const day of rateDays) {
    for (const [base, quote, rate] of P.rates.daily) db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, [base, quote, day, rate, Date.now()]);
  }
  for (const [base, quote, rate] of P.rates.today) db.run(`INSERT OR REPLACE INTO exchange_rates(base, quote, day, rate, fetched_at) VALUES (?,?,?,?,?)`, [base, quote, TODAY, rate, Date.now()]);

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
  assertTrue(Math.abs(balanceToday(savings.id) - toMinor(P.savingsTarget, CUR)) < 1, `Savings should land on ${P.savingsTarget} ${CUR}, got ${fromMinor(balanceToday(savings.id), CUR)}`);
  assertTrue(Math.abs(balanceToday(revolut.id) - toMinor(900, CARD)) < 1, `The card should land on 900.00 USD, got ${fromMinor(balanceToday(revolut.id), CARD)}`);
  for (const a of [main, cash, joint]) assertTrue(balanceToday(a.id) > 0, `${a.name} ends below zero — raise its opening balance in PROFILES.${LANG}`);


  return { rows, debts, balanceToday, periodStart: PERIOD_START, currency: CUR };
}
