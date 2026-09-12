/**
 * Default SF Symbol + colour for a category, matched from its name so imported
 * categories look right without manual setup. Cheap keyword matching, English,
 * Polish and Ukrainian. Returns null when nothing matches.
 */
export interface IconMatch { icon: string; color: string }

const RULES: [RegExp, string, string][] = [
  [/restaurant|eat out|dining|cafe|coffee|кава|кафе|ресторан|їжа поза|kebab|кебаб|burger|бургер|pizza|піц/i, "fork.knife", "#34C759"],
  [/supermarket|grocer|food|продукт|їжа|сільпо|biedronka|lidl|żabka|zabka|carrefour|auchan/i, "cart.fill", "#FF9F0A"],
  [/vitamin|witamin|supplement|pharm|аптек|ліки|medic|doctor|лікар|health|здоров/i, "cross.case.fill", "#FF375F"],
  [/rent|оренд|житл|mortgage|іпотек|home|house|дім/i, "house.fill", "#AF52DE"],
  [/tax|подат|zus|pit|vat/i, "percent", "#8E8E93"],
  [/salary|зарплат|income|дохід|payroll|wynagrodzenie/i, "banknote.fill", "#34C759"],
  [/insurance|страхув|ubezpiecz/i, "shield.fill", "#5E5CE6"],
  [/gym|sport|fitness|спорт|тренув|medicover|multisport|swim|плаван/i, "figure.run", "#30D158"],
  [/subscription|підпис|subscr|netflix|spotify|disney|apple|icloud|youtube|raycast/i, "repeat", "#BF5AF2"],
  [/car wash|мийк/i, "sparkles", "#64D2FF"],
  [/fuel|petrol|gas station|бензин|паливо|paliwo/i, "fuelpump.fill", "#FF9F0A"],
  [/car|авто|машин|parking|паркінг|taxi|таксі|uber|bolt/i, "car.fill", "#0A84FF"],
  [/transport|bus|train|metro|транспорт|потяг|квиток|ticket|bilet/i, "bus.fill", "#0A84FF"],
  [/travel|подорож|trip|flight|hotel|готел|vacation|відпуст|croatia|airbnb|booking/i, "airplane", "#64D2FF"],
  [/cat|кіт|кот|dog|пес|собак|pet|тварин|зоо/i, "pawprint.fill", "#FF9F0A"],
  [/present|gift|подарун|prezent/i, "gift.fill", "#FF375F"],
  [/haircut|barber|стрижк|перукар|beauty|cosmet|космет|nails|манікюр/i, "scissors", "#FF2D55"],
  [/baby|pregnan|вагітн|дит|kid|child|немовл/i, "figure.and.child.holdinghands", "#FF9F0A"],
  [/clothes|clothing|одяг|shoes|взутт|ubrania|fashion/i, "tshirt.fill", "#5E5CE6"],
  [/shopping|покупк|zakupy|amazon|allegro|ikea|big buy/i, "bag.fill", "#FF9F0A"],
  [/phone|телефон|mobile|internet|інтернет|wifi|play|orange|t-mobile|plus gsm/i, "antenna.radiowaves.left.and.right", "#0A84FF"],
  [/electric|gas\b|water|utilit|комунал|prąd|світло|газ|вода|bills?|рахунк|opłat/i, "bolt.fill", "#FFD60A"],
  [/education|lesson|course|school|навч|уроки|polish|польськ|english|англійськ|book|книг/i, "book.fill", "#FF375F"],
  [/game|ігр|steam|playstation|xbox|nintendo/i, "gamecontroller.fill", "#BF5AF2"],
  [/movie|cinema|кіно|theatre|театр|concert|концерт/i, "film.fill", "#FF2D55"],
  [/fun|розваг|entertain|wish|хотел|бажан|hobby|хобі/i, "star.fill", "#BF5AF2"],
  [/saving|заощадж|oszczędn|deposit|депозит/i, "building.columns.fill", "#34C759"],
  [/invest|інвест|stock|акці|crypto|крипт|etf/i, "chart.line.uptrend.xyaxis", "#30D158"],
  [/family|сім'?я|родин|wife|husband|дружин|чолов|kids?|діти|dzieci/i, "person.2.fill", "#FF9F0A"],
  [/one[- ]?time|разов|irregular|нерегуляр/i, "sparkles", "#8E8E93"],
  [/fixed|постійн|stałe/i, "pin.fill", "#8E8E93"],
  [/cash|готівк|gotówka/i, "banknote", "#34C759"],
  [/smok|цигар|tobacco|vape/i, "smoke.fill", "#8E8E93"],
  [/alcohol|beer|wine|пиво|вино|алког|bar\b/i, "wineglass.fill", "#FF2D55"],
  [/sodastream|water|вода|drink|напо/i, "drop.fill", "#64D2FF"],
  [/legal|legalis|документ|visa|віза|passport|паспорт|accountant|бухгалт/i, "doc.text.fill", "#8E8E93"],
  [/charity|donat|благодій|church|церкв/i, "heart.fill", "#FF375F"],
];

export function autoIcon(name: string): IconMatch | null {
  const n = name.normalize("NFC");
  for (const [re, icon, color] of RULES) if (re.test(n)) return { icon, color };
  return null;
}

/** Fallback when nothing matches: a stable colour from the name, generic icon. */
export function fallbackIcon(name: string): IconMatch {
  const palette = ["#0A84FF", "#34C759", "#FF9F0A", "#FF375F", "#BF5AF2", "#64D2FF", "#FFD60A", "#5E5CE6"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon: "tag.fill", color: palette[h % palette.length]! };
}

/**
 * Tag colours: one stable hue per name. A tag with no colour of its own used to be drawn in the
 * same indigo as every other one, so a row of tags read as a single block; deriving the colour from
 * the name instead tells them apart until the user picks one. Renaming a tag re-rolls it, which is
 * the point — the colour follows the word, not a value nobody chose.
 */
const TAG_PALETTE = ["#0A84FF", "#34C759", "#FF9F0A", "#FF375F", "#BF5AF2", "#64D2FF", "#FFD60A", "#5E5CE6", "#FF2D55", "#30D158", "#FF9500", "#AF52DE"];

export function tagColor(name: string, explicit?: string | null): string {
  if (explicit) return explicit;
  const key = name.normalize("NFC").trim().toLowerCase();
  if (!key) return TAG_PALETTE[0]!;
  let h = 2166136261;
  for (const ch of key) { h = (h ^ ch.charCodeAt(0)) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  // Neighbouring names ("food", "fool") differ in the low bits only; one avalanche step spreads them.
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return TAG_PALETTE[(h >>> 0) % TAG_PALETTE.length]!;
}

/** An explicit colour always wins, even when the name also auto-matches a rule (auto only supplies the icon then). */
export function iconFor(name: string, explicit?: { icon: string | null; color: string | null }): IconMatch {
  if (explicit?.icon) return { icon: explicit.icon, color: explicit.color ?? fallbackIcon(name).color };
  const auto = autoIcon(name);
  if (auto) return { icon: auto.icon, color: explicit?.color ?? auto.color };
  return { ...fallbackIcon(name), color: explicit?.color ?? fallbackIcon(name).color };
}

/**
 * Icon catalogue for the icon picker (search by name or keyword). Every symbol is available
 * on iOS 17 (SF Symbols 5.0 or earlier — checked against node_modules/sf-symbols-typescript).
 * Keeps every symbol that used to live in `ICON_PRESETS` (still exported below, derived from
 * this list) plus ~65 more covering food, drink, transport, home, utilities, health, kids,
 * pets, sport, hobbies, tech, work, travel, money, gifts, beauty, education, government,
 * subscriptions and shopping.
 */
export const ICON_CATALOG: { name: string; keywords: string }[] = [
  { name: "fork.knife", keywords: "restaurant food dinner eat lunch" },
  { name: "cart.fill", keywords: "groceries supermarket shopping cart" },
  { name: "cup.and.saucer.fill", keywords: "coffee cafe tea drink" },
  { name: "cross.case.fill", keywords: "pharmacy medicine health first aid" },
  { name: "house.fill", keywords: "home rent mortgage house" },
  { name: "percent", keywords: "tax discount interest rate" },
  { name: "banknote.fill", keywords: "salary income cash payroll" },
  { name: "shield.fill", keywords: "insurance protection safety" },
  { name: "figure.run", keywords: "gym fitness sport running exercise" },
  { name: "repeat", keywords: "subscription recurring monthly" },
  { name: "fuelpump.fill", keywords: "fuel petrol gas gasoline station" },
  { name: "car.fill", keywords: "car auto taxi parking drive" },
  { name: "bus.fill", keywords: "bus transport public transit" },
  { name: "airplane", keywords: "flight travel airport plane" },
  { name: "pawprint.fill", keywords: "pet cat dog animal" },
  { name: "gift.fill", keywords: "gift present birthday" },
  { name: "scissors", keywords: "haircut barber salon beauty" },
  { name: "figure.and.child.holdinghands", keywords: "kids children baby family" },
  { name: "tshirt.fill", keywords: "clothes clothing fashion apparel" },
  { name: "bag.fill", keywords: "shopping bag retail" },
  { name: "antenna.radiowaves.left.and.right", keywords: "phone mobile internet wifi" },
  { name: "bolt.fill", keywords: "electricity utility power bill" },
  { name: "book.fill", keywords: "education book course reading" },
  { name: "gamecontroller.fill", keywords: "games gaming videogames" },
  { name: "film.fill", keywords: "movie cinema film" },
  { name: "star.fill", keywords: "favorite fun entertainment wish" },
  { name: "building.columns.fill", keywords: "bank savings deposit government" },
  { name: "chart.line.uptrend.xyaxis", keywords: "investment stocks growth trading" },
  { name: "person.2.fill", keywords: "family people relationship" },
  { name: "sparkles", keywords: "misc one-time special irregular" },
  { name: "pin.fill", keywords: "fixed recurring pinned" },
  { name: "banknote", keywords: "cash money" },
  { name: "wineglass.fill", keywords: "wine alcohol bar drinks" },
  { name: "drop.fill", keywords: "water beverage drink" },
  { name: "doc.text.fill", keywords: "documents legal paperwork" },
  { name: "heart.fill", keywords: "charity donation love health" },
  { name: "tag.fill", keywords: "general category tag label" },
  { name: "creditcard.fill", keywords: "credit card payment" },
  { name: "wrench.and.screwdriver.fill", keywords: "repair maintenance tools" },
  { name: "leaf.fill", keywords: "nature eco green plants" },
  { name: "bicycle", keywords: "bike cycling transport" },
  { name: "tram.fill", keywords: "tram streetcar transit" },
  { name: "graduationcap.fill", keywords: "education school university tuition" },
  { name: "pills.fill", keywords: "medicine pills pharmacy health" },
  { name: "stethoscope", keywords: "doctor medical health checkup" },
  { name: "tv.fill", keywords: "television entertainment streaming" },
  { name: "music.note", keywords: "music songs concert" },
  { name: "dumbbell.fill", keywords: "gym weights fitness workout" },
  { name: "hammer.fill", keywords: "construction repair diy tools" },
  { name: "bed.double.fill", keywords: "hotel bedroom furniture sleep" },
  { name: "birthday.cake.fill", keywords: "birthday party cake celebration" },
  { name: "briefcase.fill", keywords: "work job business office" },
  { name: "key.fill", keywords: "keys rent deposit real estate" },
  { name: "lightbulb.fill", keywords: "electricity ideas utility light" },
  { name: "laptopcomputer", keywords: "tech computer work laptop" },
  { name: "takeoutbag.and.cup.and.straw.fill", keywords: "fast food takeout delivery" },
  { name: "carrot.fill", keywords: "vegetables produce healthy food" },
  { name: "popcorn.fill", keywords: "snacks cinema movie treats" },
  { name: "mug.fill", keywords: "coffee tea hot drink mug" },
  { name: "fish.fill", keywords: "seafood fish market" },
  { name: "car.2.fill", keywords: "carpool rideshare cars" },
  { name: "scooter", keywords: "scooter kick electric transport" },
  { name: "ferry.fill", keywords: "ferry boat water transport" },
  { name: "airplane.departure", keywords: "flight departure airport travel" },
  { name: "parkingsign.circle.fill", keywords: "parking fee garage" },
  { name: "flame.fill", keywords: "gas heating fireplace utility" },
  { name: "thermometer", keywords: "heating cooling temperature climate" },
  { name: "washer.fill", keywords: "laundry washing machine appliance" },
  { name: "sofa.fill", keywords: "furniture living room home" },
  { name: "heart.text.square.fill", keywords: "health record medical checkup" },
  { name: "bandage.fill", keywords: "first aid injury medical" },
  { name: "syringe.fill", keywords: "vaccine injection medical" },
  { name: "eyeglasses", keywords: "optician glasses eyewear vision" },
  { name: "teddybear.fill", keywords: "toys kids children baby" },
  { name: "stroller.fill", keywords: "baby stroller kids infant" },
  { name: "hare.fill", keywords: "pet rabbit animal" },
  { name: "tortoise.fill", keywords: "pet turtle animal" },
  { name: "soccerball", keywords: "football soccer sport" },
  { name: "basketball.fill", keywords: "basketball sport" },
  { name: "tennis.racket", keywords: "tennis sport racket" },
  { name: "tennisball.fill", keywords: "tennis ball sport" },
  { name: "figure.pool.swim", keywords: "swimming pool sport" },
  { name: "figure.hiking", keywords: "hiking outdoors trekking" },
  { name: "paintpalette.fill", keywords: "art painting hobby craft" },
  { name: "theatermasks.fill", keywords: "theatre drama performance" },
  { name: "camera.fill", keywords: "photography camera hobby" },
  { name: "guitars.fill", keywords: "music instrument guitar hobby" },
  { name: "desktopcomputer", keywords: "computer tech electronics" },
  { name: "printer.fill", keywords: "printer office supplies" },
  { name: "headphones", keywords: "audio music tech electronics" },
  { name: "keyboard", keywords: "computer accessories tech" },
  { name: "building.2.fill", keywords: "office work company building" },
  { name: "person.crop.rectangle.fill", keywords: "id badge document identification" },
  { name: "suitcase.fill", keywords: "travel luggage business trip" },
  { name: "map.fill", keywords: "travel navigation trip map" },
  { name: "beach.umbrella.fill", keywords: "vacation beach holiday" },
  { name: "mountain.2.fill", keywords: "hiking mountains outdoors nature" },
  { name: "dollarsign.circle.fill", keywords: "money currency dollar finance" },
  { name: "eurosign.circle.fill", keywords: "money currency euro finance" },
  { name: "wallet.pass.fill", keywords: "wallet card pass loyalty" },
  { name: "balloon.2.fill", keywords: "party celebration gift" },
  { name: "comb.fill", keywords: "beauty grooming hair salon" },
  { name: "pencil.and.ruler.fill", keywords: "school supplies education stationery" },
  { name: "backpack.fill", keywords: "school backpack bag education" },
  { name: "checkmark.seal.fill", keywords: "government certificate official document" },
  { name: "play.rectangle.fill", keywords: "streaming subscription video" },
  { name: "newspaper.fill", keywords: "news subscription magazine media" },
  { name: "basket.fill", keywords: "shopping basket groceries market" },
  { name: "person.3.fill", keywords: "group friends social event" },
  { name: "figure.walk", keywords: "walking commute exercise" },
  { name: "train.side.front.car", keywords: "train transport rail" },
  { name: "cablecar.fill", keywords: "cable car ski transport" },
  { name: "cross.fill", keywords: "hospital pharmacy medical church" },
  { name: "building.fill", keywords: "office building generic government" },
  { name: "house.and.flag.fill", keywords: "home real estate national" },
  { name: "lock.fill", keywords: "security safe subscription" },
  { name: "giftcard.fill", keywords: "gift card voucher" },
  { name: "figure.yoga", keywords: "yoga fitness wellness" },
  { name: "trash.fill", keywords: "waste garbage collection utility" },
  { name: "moon.stars.fill", keywords: "nightlife bar club evening entertainment" },
];

/** Preset symbols offered in the category editor. */
export const ICON_PRESETS: string[] = ICON_CATALOG.map((i) => i.name);

/**
 * 24 clearly distinct colours: 12 evenly spaced hues (red → pink) at a saturated, medium
 * lightness, then 10 darker/pastel variants of a subset of those hues, ending with neutral
 * grey and brown. Hex values are pre-computed (HSL→hex) so the list stays static; `name` is
 * the accessibility label ("Colour teal") and doubles as the hue family (stripped of its
 * " dark"/" pastel" suffix) so no two consecutive entries read as the same colour.
 */
export const COLORS: { hex: string; name: string }[] = [
  { hex: "#DB3624", name: "red" },
  { hex: "#E3791C", name: "orange" },
  { hex: "#E2A412", name: "amber" },
  { hex: "#ECD613", name: "yellow" },
  { hex: "#77B82E", name: "lime" },
  { hex: "#2E9E53", name: "green" },
  { hex: "#22A08F", name: "teal" },
  { hex: "#25AED0", name: "cyan" },
  { hex: "#367BE2", name: "blue" },
  { hex: "#6959CF", name: "indigo" },
  { hex: "#8C4DCB", name: "violet" },
  { hex: "#E0529E", name: "pink" },
  { hex: "#176D62", name: "teal dark" },
  { hex: "#7A281F", name: "red dark" },
  { hex: "#C9E6A8", name: "lime pastel" },
  { hex: "#2E2277", name: "indigo dark" },
  { hex: "#EBE4AD", name: "yellow pastel" },
  { hex: "#52257E", name: "violet dark" },
  { hex: "#E9C5A5", name: "orange pastel" },
  { hex: "#1E3B67", name: "blue dark" },
  { hex: "#E8B0CE", name: "pink pastel" },
  { hex: "#1C5F32", name: "green dark" },
  { hex: "#8C8C8C", name: "grey" },
  { hex: "#724C31", name: "brown" },
];
export const COLOR_PRESETS = COLORS.map((c) => c.hex);
