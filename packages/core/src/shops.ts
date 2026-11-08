/**
 * Shops everybody knows, and what they sell (DATA.md rule 21).
 *
 * A payment at a chain nobody has filed before still says something: "JMP S.A. BIEDRONKA 1234" is
 * groceries, "WOG" is fuel, "UKLON" a taxi. This list maps the shop to a *type* (categoryTypes.ts),
 * never to a category: the type is then filed into whichever of your categories carries it, whatever
 * it is called. So "Biedronka" lands in "Groceries", "Продукти" or "Їжа вдома" alike.
 *
 * It is the last thing asked before location and only ever a guess: your own history for the shop
 * comes first (`payeeHistory`), and a payment filed from this list is logged pending and marked as a
 * guess (`source` = "shortcut-guess", rule 9) until you confirm it once — after that it is history.
 *
 * Terms are matched as whole words of the normalised name (`normalizeName`: case, accents and
 * punctuation off, Cyrillic kept), the longest one winning, so "UBER EATS" is a restaurant and
 * "UBER" a taxi, "BOLT FOOD" food and "BOLT" a ride. Ukrainian shops carry both spellings: the bank
 * prints "SILPO", the receipt "Сільпо". A marketplace that sells everything (Allegro, Amazon, OLX,
 * Temu) is deliberately absent: any guess there is wrong more often than right.
 *
 * native/KPShops.swift is generated from this list (`bun run scripts/shops.ts`); a test fails when
 * the two drift.
 */
import { normalizeName } from "./logos";

export interface Shop { type: string; terms: string[] }

export const SHOPS: Shop[] = [
  // ── Groceries ───────────────────────────────────────────────────────────────────────────────
  { type: "food.groceries", terms: [
    // Poland
    "biedronka", "lidl", "zabka", "auchan", "kaufland", "carrefour", "netto", "dino", "stokrotka", "lewiatan",
    "polomarket", "intermarche", "aldi", "spolem", "frisco", "delikatesy centrum", "eurospar", "spar", "mila",
    "topaz", "chata polska", "groszek", "freshmarket", "zabka nano", "eleclerc", "e leclerc", "lisek",
    // Ukraine
    "atb", "атб", "atb market", "silpo", "сільпо", "novus", "новус", "fora", "фора", "varus", "варус",
    "ashan", "ашан", "eko market", "еко маркет", "velyka kyshenia", "велика кишеня", "nash krai", "наш край",
    "tavria v", "таврія в", "megamarket", "мегамаркет", "metro cash", "rukavychka", "рукавичка", "blyzenko", "близенько",
    "kopiyochka", "копійочка", "fozzy", "фоззі", "le silpo", "lotok", "лоток",
    // Worldwide
    "tesco", "rewe", "edeka", "sainsbury", "sainsburys", "asda", "mercadona", "billa", "penny", "albert heijn",
    "whole foods", "trader joe", "walmart", "costco", "migros", "coop",
  ] },
  // ── Restaurants & delivery ──────────────────────────────────────────────────────────────────
  { type: "food.restaurants", terms: [
    "mcdonalds", "mcdonald", "макдональдз", "kfc", "burger king", "subway", "pizza hut", "dominos", "domino s",
    "telepizza", "max burgers", "north fish", "sushi master", "sushiya", "puzata hata", "пузата хата",
    "salateira", "салатейра", "mafia", "мафія", "uber eats", "bolt food", "glovo", "wolt", "pyszne", "pyszne pl",
    "deliveroo", "just eat", "lieferando", "foodpanda", "five guys", "nando s", "vapiano", "sphinx", "dodo pizza",
  ] },
  // ── Coffee & snacks ─────────────────────────────────────────────────────────────────────────
  { type: "food.coffee", terms: [
    "starbucks", "costa coffee", "green caffe nero", "caffe nero", "tim hortons", "pret a manger", "so coffee",
    "aroma kava", "арома кава", "lviv croissants", "львівські круасани", "coffee life", "dunkin",
    "grycan", "wedel",
  ] },
  // ── Fuel ────────────────────────────────────────────────────────────────────────────────────
  { type: "transport.fuel", terms: [
    "orlen", "bp", "shell", "circle k", "lotos", "amic", "moya", "lukoil", "esso", "aral", "total", "totalenergies",
    "mol", "omv", "statoil", "wog", "окко", "okko", "upg", "socar", "сокар", "klo", "кло", "brsm", "брсм",
    "avias", "авіас", "ukrnafta", "укрнафта", "glusco",
  ] },
  // ── Taxi ────────────────────────────────────────────────────────────────────────────────────
  { type: "transport.taxi", terms: [
    "uber", "bolt", "freenow", "free now", "uklon", "уклон", "itaxi", "lyft", "ontaxi", "on taxi",
  ] },
  // ── Public transport ────────────────────────────────────────────────────────────────────────
  { type: "transport.publicTransport", terms: [
    "jakdojade", "pkp", "intercity", "pkp intercity", "koleje mazowieckie", "skm", "ztm", "mpk", "koleo", "polregio",
    "flixbus", "ukrzaliznytsia", "укрзалізниця", "kyivpastrans", "київпастранс", "metropoliten", "метрополітен",
    "trainline", "db bahn", "deutsche bahn", "tfl", "omio",
  ] },
  // ── Parking ─────────────────────────────────────────────────────────────────────────────────
  { type: "transport.parking", terms: [
    "mobiparking", "mobi parking", "parkomat", "apcoa", "interparking", "easypark", "q park", "qpark", "saba",
    "parking", "parkowanie", "spp", "паркування", "парковка", "kyiv parking", "parkovka",
  ] },
  // ── Car ─────────────────────────────────────────────────────────────────────────────────────
  { type: "transport.car", terms: ["norauto", "inter cars", "vianor", "autodoc", "myjnia", "автомийка"] },
  // ── Pharmacy ────────────────────────────────────────────────────────────────────────────────
  { type: "health.pharmacy", terms: [
    "apteka", "аптека", "doz", "gemini", "ziko", "dbam o zdrowie", "super pharm", "superpharm", "cefarm",
    "anc", "анц", "podorozhnyk", "подорожник", "bazhaemo zdorovya", "бажаємо здоровʼя", "apteka 911", "аптека 911",
    "pharmacy", "boots",
  ] },
  // ── Doctor ──────────────────────────────────────────────────────────────────────────────────
  { type: "health.doctor", terms: [
    "luxmed", "lux med", "medicover", "enel med", "enelmed", "diagnostyka", "alab", "dobrobut", "добробут",
    "synevo", "сінево", "into sana", "into-sana", "medikom", "медіком",
  ] },
  // ── Gym ─────────────────────────────────────────────────────────────────────────────────────
  { type: "health.gym", terms: [
    "zdrofit", "calypso", "just gym", "multisport", "medicover sport", "sport life", "спорт лайф", "smart gym",
    "pure jatomi", "my fitness place", "gymshark",
  ] },
  // ── Household & drugstore ───────────────────────────────────────────────────────────────────
  { type: "shopping.household", terms: [
    "rossmann", "hebe", "pepco", "action", "dm", "watsons", "tedi", "eva", "єва", "prostor", "простір",
    "kosmo", "космо", "dealz", "flying tiger",
  ] },
  // ── Clothes & shoes ─────────────────────────────────────────────────────────────────────────
  { type: "shopping.clothes", terms: [
    "zara", "h m", "reserved", "sinsay", "cropp", "mohito", "ccc", "deichmann", "zalando", "answear",
    "modivo", "decathlon", "primark", "uniqlo", "pull bear", "bershka", "stradivarius", "massimo dutti",
    "new yorker", "kik", "intertop", "інтертоп", "colin s", "lc waikiki", "shein", "vinted", "eobuwie", "4f",
    "mango", "tk maxx",
  ] },
  // ── Electronics ─────────────────────────────────────────────────────────────────────────────
  { type: "shopping.electronics", terms: [
    "media expert", "euro rtv agd", "rtv euro agd", "media markt", "mediamarkt", "x kom", "komputronik", "morele",
    "neonet", "rozetka", "розетка", "comfy", "комфі", "foxtrot", "фокстрот", "allo", "алло", "moyo", "мойо",
    "citrus", "цитрус", "eldorado", "ельдорадо", "apple store", "istore", "saturn", "currys", "best buy",
  ] },
  // ── Furniture & DIY ─────────────────────────────────────────────────────────────────────────
  { type: "home.furniture", terms: [
    "ikea", "jysk", "agata meble", "black red white", "leroy merlin", "castorama", "obi", "bricomarche",
    "epicentr", "епіцентр", "nova liniya", "нова лінія", "jysk", "home depot", "bauhaus", "hornbach",
  ] },
  // ── Internet & phone ────────────────────────────────────────────────────────────────────────
  { type: "home.internet", terms: [
    "orange", "t mobile", "upc", "vectra", "netia", "inea", "kyivstar", "київстар", "vodafone", "lifecell",
    "лайфселл", "volia", "воля", "ukrtelecom", "укртелеком", "lanet", "ланет", "triolan", "тріолан", "starlink",
  ] },
  // ── Utilities ───────────────────────────────────────────────────────────────────────────────
  { type: "home.utilities", terms: [
    "pge", "tauron", "enea", "energa", "innogy", "e on", "eon", "pgnig", "veolia", "mpwik", "yasno", "ясно",
    "dtek", "дтек", "naftogaz", "нафтогаз", "gazopostachannya", "газопостачання", "vodokanal", "водоканал",
    "teploenergo", "теплоенерго", "kyivteploenergo", "київтеплоенерго", "oblenergo", "обленерго",
  ] },
  // ── Subscriptions ───────────────────────────────────────────────────────────────────────────
  { type: "bills.subscriptions", terms: [
    "netflix", "spotify", "youtube", "youtube premium", "disney", "disney plus", "hbo", "hbo max", "apple com bill",
    "icloud", "google one", "chatgpt", "openai", "anthropic", "claude ai", "megogo", "мегого", "sweet tv",
    "player pl", "canal", "audible", "patreon", "github", "dropbox", "notion", "adobe", "microsoft", "xbox game pass",
    "playstation plus", "tidal", "deezer", "kyivstar tv", "takflix", "storytel", "legimi", "empik go",
  ] },
  // ── Insurance ───────────────────────────────────────────────────────────────────────────────
  { type: "bills.insurance", terms: ["pzu", "warta", "allianz", "ergo hestia", "generali", "uniqa", "link4", "оранта", "oranta", "ingo", "інго"] },
  // ── Entertainment ───────────────────────────────────────────────────────────────────────────
  { type: "fun.entertainment", terms: [
    "cinema city", "multikino", "helios", "planeta kino", "планета кіно", "multiplex", "мультиплекс", "karabas",
    "карабас", "concert ua", "ebilet", "eventim", "ticketmaster", "biletomat", "steam", "playstation", "nintendo",
    "kino",
  ] },
  // ── Travel ──────────────────────────────────────────────────────────────────────────────────
  { type: "fun.travel", terms: [
    "booking com", "airbnb", "ryanair", "wizz air", "wizzair", "easyjet", "lot polish", "expedia", "hotels com",
    "skyscanner", "kiwi com", "agoda", "trip com", "lufthansa", "turkish airlines",
  ] },
  // ── Beauty ──────────────────────────────────────────────────────────────────────────────────
  { type: "personal.beauty", terms: ["sephora", "douglas", "notino", "inglot", "makeup", "makeup ua", "barber", "barbershop", "барбершоп", "fresha", "booksy"] },
  // ── Education & books ───────────────────────────────────────────────────────────────────────
  { type: "personal.education", terms: ["udemy", "coursera", "duolingo", "yakaboo", "якабу", "prometheus", "skillbox", "empik", "bookling", "книгарня є", "knyharnia ye"] },
  // ── Pets ────────────────────────────────────────────────────────────────────────────────────
  { type: "family.pets", terms: ["zooplus", "maxi zoo", "kakadu", "masterzoo", "мастерзоо", "zoo market", "зоомаркет", "petsmart", "fressnapf"] },
  // ── Kids ────────────────────────────────────────────────────────────────────────────────────
  { type: "family.kids", terms: ["smyk", "antoshka", "антошка", "budynok igrashok", "будинок іграшок", "toys r us", "lego store"] },
];

/** Every term, normalised once, with its type, longest first. */
let table: { term: string; type: string }[] | null = null;
export function shopTerms(): { term: string; type: string }[] {
  if (table) return table;
  const seen = new Map<string, string>();
  for (const s of SHOPS) for (const t of s.terms) { const n = normalizeName(t); if (n && !seen.has(n)) seen.set(n, s.type); }
  table = [...seen].map(([term, type]) => ({ term, type })).sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
  return table;
}

/** The known shop a name contains — its term and type — or null. Whole words, longest term first. */
export function knownShop(...names: (string | null | undefined)[]): { term: string; type: string } | null {
  for (const raw of names) {
    const n = raw ? ` ${normalizeName(raw)} ` : "";
    if (n.trim().length < 2) continue;
    for (const t of shopTerms()) if (n.includes(` ${t.term} `)) return t;
  }
  return null;
}

/** The type a shop's name says it is, or null. */
export function shopType(...names: (string | null | undefined)[]): string | null { return knownShop(...names)?.type ?? null; }
