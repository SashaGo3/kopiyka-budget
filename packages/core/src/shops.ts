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
    "makro", "selgros", "piotr i pawel", "chorten", "duzy ben", "carrefour express", "carrefour market", "polo market", "dino polska", "gram market", "odido", "top market", "prim market", "furshet", "фуршет", "velmart", "вельмарт", "ultramarket", "ультрамаркет", "pchilka", "пчілка", "sim23", "траш", "metro cash carry", "market opt", "маркет опт",
  ] },
  // ── Restaurants & delivery ──────────────────────────────────────────────────────────────────
  { type: "food.restaurants", terms: [
    "mcdonalds", "mcdonald", "макдональдз", "kfc", "burger king", "subway", "pizza hut", "dominos", "domino s",
    "telepizza", "max burgers", "north fish", "sushi master", "sushiya", "puzata hata", "пузата хата",
    "salateira", "салатейра", "mafia", "мафія", "uber eats", "bolt food", "glovo", "wolt", "pyszne", "pyszne pl",
    "deliveroo", "just eat", "lieferando", "foodpanda", "five guys", "nando s", "vapiano", "sphinx", "dodo pizza",
    "restauracja", "pizzeria", "kebab", "bar mleczny", "pasibus", "bobby burger", "da grasso", "sfinks", "pizza dominium", "thai wok", "mcdonald s", "ресторан", "піцерія", "шаурма", "celentano", "челентано", "pizza celentano", "mister cat", "містер кет", "sushi wok", "дім шаурми", "chicken hut", "україночка", "чорноморка", "chornomorka", "veterano", "ветерано", "kyiv food market",
  ] },
  // ── Coffee & snacks ─────────────────────────────────────────────────────────────────────────
  { type: "food.coffee", terms: [
    "starbucks", "costa coffee", "green caffe nero", "caffe nero", "tim hortons", "pret a manger", "so coffee",
    "aroma kava", "арома кава", "lviv croissants", "львівські круасани", "coffee life", "dunkin",
    "grycan", "wedel",
    "kawiarnia", "cukiernia", "piekarnia", "blikle", "etno cafe", "coffeedesk", "lody", "inmedio", "кавʼярня", "кав ярня", "кофейня", "пекарня", "цукерня", "roshen", "рошен", "kulikov", "куліков", "one love espresso", "kredens", "креденс", "львівська майстерня шоколаду", "vsi svoi", "first point",
  ] },
  // ── Fuel ────────────────────────────────────────────────────────────────────────────────────
  { type: "transport.fuel", terms: [
    "orlen", "bp", "shell", "circle k", "lotos", "amic", "moya", "lukoil", "esso", "aral", "total", "totalenergies",
    "mol", "omv", "statoil", "wog", "окко", "okko", "upg", "socar", "сокар", "klo", "кло", "brsm", "брсм",
    "avias", "авіас", "ukrnafta", "укрнафта", "glusco",
    "stacja paliw", "azs", "азс", "motto", "мотто", "autotrade", "автотрейд",
  ] },
  // ── Taxi ────────────────────────────────────────────────────────────────────────────────────
  { type: "transport.taxi", terms: [
    "uber", "bolt", "freenow", "free now", "uklon", "уклон", "itaxi", "lyft", "ontaxi", "on taxi",
    "taxi", "taksi", "taksowka", "таксі", "такси", "ilu taxi", "opti taxi", "glob taxi", "ele taxi",
  ] },
  // ── Public transport ────────────────────────────────────────────────────────────────────────
  { type: "transport.publicTransport", terms: [
    "jakdojade", "pkp", "intercity", "pkp intercity", "koleje mazowieckie", "skm", "ztm", "mpk", "koleo", "polregio",
    "flixbus", "ukrzaliznytsia", "укрзалізниця", "kyivpastrans", "київпастранс", "metropoliten", "метрополітен",
    "trainline", "db bahn", "deutsche bahn", "tfl", "omio",
    "koleje slaskie", "koleje dolnoslaskie", "koleje wielkopolskie", "lodzka kolej", "wkd", "regiojet", "leo express", "busfor", "gunsel", "ecolines", "bilkom", "kyiv tsyfrovyi", "київ цифровий",
  ] },
  // ── Parking ─────────────────────────────────────────────────────────────────────────────────
  { type: "transport.parking", terms: [
    "mobiparking", "mobi parking", "parkomat", "apcoa", "interparking", "easypark", "q park", "qpark", "saba",
    "parking", "parkowanie", "spp", "паркування", "парковка", "kyiv parking", "parkovka",
    "strefa platnego parkowania", "parking miejski", "park and ride", "моя парковка",
  ] },
  // ── Bike & scooter ──────────────────────────────────────────────────────────────────────────
  { type: "transport.bike", terms: [
    "nextbike", "veturilo", "wroclawski rower miejski", "rower miejski", "tier mobility", "dott", "voi technology", "voiscooters", "hulajnoga", "hulajnogi",
    "bird rides", "lime ride", "limebike", "велопрокат", "nextbike ua",
  ] },
  // ── Cash ────────────────────────────────────────────────────────────────────────────────────
  { type: "personal.cash", terms: ["bankomat", "wyplata z bankomatu", "euronet", "atm", "cash withdrawal", "банкомат", "зняття готівки", "видача готівки"] },
  // ── Car ─────────────────────────────────────────────────────────────────────────────────────
  { type: "transport.car", terms: ["norauto", "inter cars", "vianor", "autodoc", "myjnia", "автомийка",
    "oponeo", "wulkanizacja", "stacja kontroli pojazdow", "car wash", "шиномонтаж", "автозапчастини", "автосервіс", "avtopro", "автопро", "bosch car service",
  ] },
  // ── Pharmacy ────────────────────────────────────────────────────────────────────────────────
  { type: "health.pharmacy", terms: [
    "apteka", "аптека", "doz", "gemini", "ziko", "dbam o zdrowie", "super pharm", "superpharm", "cefarm",
    "anc", "анц", "podorozhnyk", "подорожник", "bazhaemo zdorovya", "бажаємо здоровʼя", "apteka 911", "аптека 911",
    "pharmacy", "boots",
    "dr max", "drmax", "apteki dbam o zdrowie", "tabletki", "tabletki ua", "аптека доброго дня", "ощадна аптека", "аптека низьких цін", "liki24", "ліки24",
  ] },
  // ── Doctor ──────────────────────────────────────────────────────────────────────────────────
  { type: "health.doctor", terms: [
    "luxmed", "lux med", "medicover", "enel med", "enelmed", "diagnostyka", "alab", "dobrobut", "добробут",
    "synevo", "сінево", "into sana", "into-sana", "medikom", "медіком",
    "dentysta", "stomatolog", "stomatologia", "przychodnia", "znany lekarz", "znanylekarz", "pzu zdrowie", "scanmed", "стоматологія", "стоматолог", "oxford medical", "оксфорд медікал", "esculab", "ескулаб", "medlab", "медлаб", "boris clinic", "isida", "ісіда", "helsi", "хелсі",
  ] },
  // ── Gym ─────────────────────────────────────────────────────────────────────────────────────
  { type: "health.gym", terms: [
    "zdrofit", "calypso", "just gym", "multisport", "medicover sport", "sport life", "спорт лайф", "smart gym",
    "pure jatomi", "my fitness place", "gymshark",
    "fitness", "фітнес", "silownia", "basen", "басейн", "fabryka formy", "benefit systems", "mcfit", "golds gym", "energy fitness", "yoga", "йога", "тренажерний зал", "atletic", "атлетик", "fitness platinum", "фітнес платинум",
  ] },
  // ── Household & drugstore ───────────────────────────────────────────────────────────────────
  { type: "shopping.household", terms: [
    "rossmann", "hebe", "pepco", "action", "dm", "watsons", "tedi", "eva", "єва", "prostor", "простір",
    "kosmo", "космо", "dealz", "flying tiger",
    "drogeria", "drogerie natura", "jula", "homla", "home you", "аврора", "avrora", "мультимаркет",
  ] },
  // ── Clothes & shoes ─────────────────────────────────────────────────────────────────────────
  { type: "shopping.clothes", terms: [
    "zara", "h m", "reserved", "sinsay", "cropp", "mohito", "ccc", "deichmann", "zalando", "answear",
    "modivo", "decathlon", "primark", "uniqlo", "pull bear", "bershka", "stradivarius", "massimo dutti",
    "new yorker", "kik", "intertop", "інтертоп", "colin s", "lc waikiki", "shein", "vinted", "eobuwie", "4f",
    "mango", "tk maxx",
    "big star", "wolczanka", "vistula", "tatuum", "monnari", "ochnik", "wittchen", "wojas", "gino rossi", "sizeer", "terranova", "calzedonia", "intimissimi", "takko", "cubus", "renee", "worldbox", "ostin", "остін", "kasta", "braska", "браска", "megasport", "мегаспорт", "sportmaster", "gepur", "гепур",
  ] },
  // ── Electronics ─────────────────────────────────────────────────────────────────────────────
  { type: "shopping.electronics", terms: [
    "media expert", "euro rtv agd", "rtv euro agd", "media markt", "mediamarkt", "x kom", "komputronik", "morele",
    "neonet", "rozetka", "розетка", "comfy", "комфі", "foxtrot", "фокстрот", "allo", "алло", "moyo", "мойо",
    "citrus", "цитрус", "eldorado", "ельдорадо", "apple store", "istore", "saturn", "currys", "best buy",
    "oleole", "ispot", "cyfrowe pl", "rtv euro", "jabko", "ябко", "ktc", "ктс", "brain com ua", "telemart", "телемарт", "mi store", "vseplus", "всеплюс",
  ] },
  // ── Furniture & DIY ─────────────────────────────────────────────────────────────────────────
  { type: "home.furniture", terms: [
    "ikea", "jysk", "agata meble", "black red white", "leroy merlin", "castorama", "obi", "bricomarche",
    "epicentr", "епіцентр", "nova liniya", "нова лінія", "jysk", "home depot", "bauhaus", "hornbach",
    "abra meble", "bodzio", "psb mrowka", "mrowka", "merkury market", "praktiker", "meble vox", "agata meble", "леруа мерлен", "будмаркет", "meblium", "мебліум", "sofino", "софіно",
  ] },
  // ── Internet & phone ────────────────────────────────────────────────────────────────────────
  { type: "home.internet", terms: [
    "orange", "t mobile", "upc", "vectra", "netia", "inea", "kyivstar", "київстар", "vodafone", "lifecell",
    "лайфселл", "volia", "воля", "ukrtelecom", "укртелеком", "lanet", "ланет", "triolan", "тріолан", "starlink",
    "nju mobile", "heyah", "polsat box", "cyfrowy polsat", "plus gsm", "polkomtel", "play mobile", "multimedia polska", "toya", "datagroup", "датагруп", "tenet", "тенет", "maxnet", "інтертелеком", "intertelecom", "fregat", "фрегат",
  ] },
  // ── Utilities ───────────────────────────────────────────────────────────────────────────────
  { type: "home.utilities", terms: [
    "pge", "tauron", "enea", "energa", "innogy", "e on", "eon", "pgnig", "veolia", "mpwik", "yasno", "ясно",
    "dtek", "дтек", "naftogaz", "нафтогаз", "gazopostachannya", "газопостачання", "vodokanal", "водоканал",
    "teploenergo", "теплоенерго", "kyivteploenergo", "київтеплоенерго", "oblenergo", "обленерго",
    "fortum", "mpec", "wodociagi", "polska spolka gazownictwa", "veolia energia", "wywoz smieci", "osbb", "осбб", "жек", "квартплата", "київводоканал", "kyivvodokanal", "gazmerezhi", "газмережі", "газорозподільні мережі", "енергозбут", "energozbut", "газзбут", "комунальні послуги", "київенерго", "тепломережа", "вивіз сміття",
  ] },
  // ── Subscriptions ───────────────────────────────────────────────────────────────────────────
  { type: "bills.subscriptions", terms: [
    "netflix", "spotify", "youtube", "youtube premium", "disney", "disney plus", "hbo", "hbo max", "apple com bill",
    "icloud", "google one", "chatgpt", "openai", "anthropic", "claude ai", "megogo", "мегого", "sweet tv",
    "player pl", "canal", "audible", "patreon", "github", "dropbox", "notion", "adobe", "microsoft", "xbox game pass",
    "playstation plus", "tidal", "deezer", "kyivstar tv", "takflix", "storytel", "legimi", "empik go",
    "amazon prime", "prime video", "apple music", "apple tv", "youtube music", "canva", "figma", "1password", "nordvpn", "tinder", "linkedin", "viaplay", "skyshowtime", "polsat box go", "canal plus", "cda premium", "allegro smart", "glovo prime", "wolt plus", "uber one", "oll tv", "divan tv", "київстар тб", "jetbrains", "paramount",
  ] },
  // ── Insurance ───────────────────────────────────────────────────────────────────────────────
  { type: "bills.insurance", terms: ["pzu", "warta", "allianz", "ergo hestia", "generali", "uniqa", "link4", "vienna life", "оранта", "oranta", "ingo", "інго",
    "compensa", "aviva", "nationale nederlanden", "axa", "interrisk", "proama", "vuso", "вусо", "universalna", "універсальна", "providna", "провідна", "ubezpieczenie", "страхування",
  ] },
  // ── Taxes: the tax office and social security, as banks print them ─────────────────────────────
  { type: "bills.taxes", terms: [
    "zaklad ubezpieczen spolecznych", "zus", "urzad skarbowy", "mikrorachunek podatkowy", "e urzad skarbowy",
    "дпс", "державна податкова служба", "податкова", "єдиний податок", "hmrc", "finanzamt",
    "podatek", "podatek od nieruchomosci", "mandat", "штраф", "податок", "єсв", "пдфо", "krajowa administracja skarbowa",
  ] },
  // ── Entertainment ───────────────────────────────────────────────────────────────────────────
  { type: "fun.entertainment", terms: [
    "cinema city", "multikino", "helios", "planeta kino", "планета кіно", "multiplex", "мультиплекс", "karabas",
    "карабас", "concert ua", "ebilet", "eventim", "ticketmaster", "biletomat", "steam", "playstation", "nintendo",
    "kino",
    "teatr", "театр", "filharmonia", "філармонія", "muzeum", "музей", "bilety24", "kupbilecik", "biletyna", "koncert", "концерт", "bowling", "боулінг", "escape room", "квест", "aquapark", "аквапарк", "зоопарк", "кінотеатр", "kinoland",
  ] },
  // ── Travel ──────────────────────────────────────────────────────────────────────────────────
  { type: "fun.travel", terms: [
    "booking com", "airbnb", "ryanair", "wizz air", "wizzair", "easyjet", "lot polish", "expedia", "hotels com",
    "skyscanner", "kiwi com", "agoda", "trip com", "lufthansa", "turkish airlines",
    "hotel", "готель", "hostel", "хостел", "skyup", "скайап", "windrose", "tui", "itaka", "rainbow tours", "wakacje pl", "coral travel", "anex tour", "join up", "trivago", "blablacar", "vrbo", "klm", "air france", "british airways", "ukraine international", "lot polish airlines",
  ] },
  // ── Beauty ──────────────────────────────────────────────────────────────────────────────────
  { type: "personal.beauty", terms: ["sephora", "douglas", "notino", "inglot", "makeup", "makeup ua", "barber", "barbershop", "барбершоп", "fresha", "booksy",
    "salon fryzjerski", "fryzjer", "kosmetyczka", "manicure", "перукарня", "салон краси", "манікюр", "brocard", "брокард", "золоте яблуко", "gold apple", "goldapple", "barber shop",
  ] },
  // ── Education & books ───────────────────────────────────────────────────────────────────────
  { type: "personal.education", terms: ["udemy", "coursera", "duolingo", "yakaboo", "якабу", "prometheus", "skillbox", "empik", "bookling", "книгарня є", "knyharnia ye",
    "szkola jezykowa", "busuu", "preply", "italki", "lingoda", "projector", "книгарня", "ksiegarnia", "taniaksiazka", "bonito", "vivat", "віват",
  ] },
  // ── Pets ────────────────────────────────────────────────────────────────────────────────────
  { type: "family.pets", terms: ["zooplus", "maxi zoo", "kakadu", "masterzoo", "мастерзоо", "zoo market", "зоомаркет", "petsmart", "fressnapf",
    "weterynarz", "lecznica", "przychodnia weterynaryjna", "ветеринар", "ветклініка", "ветеринарна клініка", "zoo karina", "royal canin", "petmarket", "зоокомплекс", "zoocomplex",
  ] },
  // ── Kids ────────────────────────────────────────────────────────────────────────────────────
  { type: "family.kids", terms: ["smyk", "antoshka", "антошка", "budynok igrashok", "будинок іграшок", "toys r us", "lego store",
    "mothercare", "pampers", "zlobek", "przedszkole", "дитсадок", "дитячий садок", "дитячий світ", "chicco",
  ] },
  { type: "health.vitamins", terms: [
    "olimp sport", "myprotein", "my protein", "trec nutrition", "ostrovit", "iherb", "спортивне харчування",
  ] },
  { type: "home.rent", terms: [
    "czynsz", "spoldzielnia mieszkaniowa", "оренда квартири", "орендна плата",
  ] },
  { type: "bills.fees", terms: [
    "prowizja", "oplata za prowadzenie", "oplata za karte", "oplata miesieczna", "prowadzenie rachunku", "komisja", "комісія", "bank fee", "monthly fee", "card fee", "account fee", "обслуговування картки", "обслуговування рахунку",
  ] },
  { type: "bills.services", terms: [
    "notariusz", "notariat", "kancelaria", "biuro rachunkowe", "ksiegowosc", "нотаріус", "адвокат", "бухгалтерські послуги", "юридичні послуги", "infakt", "ifirma", "fakturownia", "wfirma",
  ] },
  { type: "personal.charity", terms: [
    "wosp", "wielka orkiestra", "siepomaga", "pomagam pl", "polska akcja humanitarna", "unicef", "caritas", "red cross", "czerwony krzyz", "pajacyk", "patronite", "повернись живим", "come back alive", "savelife", "фонд притули", "prytula foundation", "united24", "червоний хрест", "благодійний фонд",
  ] },
  { type: "personal.hobbies", terms: [
    "thomann", "muzyczny pl", "games workshop", "artmarket",
  ] },
  { type: "fun.presents", terms: [
    "kwiaciarnia", "kwiaty", "квіти", "flowwow", "букет", "karta podarunkowa", "подарунковий сертифікат", "uaflora", "starsflowers",
  ] },
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
