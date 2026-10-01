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
  // Appended rather than slotted in: the first rule to match wins, so a new one at the end can
  // only ever name something that used to fall through to the generic fallback.
  [/dentist|dentyst|стоматолог|\bteeth\b|зуб/i, "mouth.fill", "#64D2FF"],
  [/\bvet\b|ветеринар|weterynarz/i, "pawprint.fill", "#FF9F0A"],
  [/delivery|courier|кур'?єр|доставк|parcel|paczk|post office|пошт|poczt/i, "shippingbox.fill", "#FF9F0A"],
  [/laundry|dry clean|пральн|pralni|хімчистк/i, "washer.fill", "#0A84FF"],
  [/clean|прибиран|sprzątan/i, "sparkle", "#64D2FF"],
  [/furniture|меблі|meble/i, "sofa.fill", "#AF52DE"],
  [/electronic|техніка|elektronik|\brtv\b/i, "sparkles.tv.fill", "#5E5CE6"],
  [/\bfines?\b|штраф|mandat|penalt/i, "exclamationmark.triangle.fill", "#FF453A"],
  [/loan|\bcredit\b|кредит|позик|debt|борг|dług|\brata\b|розстрочк/i, "dollarsign.arrow.circlepath", "#FF9500"],
  [/\btoys?\b|іграшк|zabawk/i, "teddybear.fill", "#FF9F0A"],
  [/stationer|канцеляр|канцтовар|papiernic/i, "pencil.and.ruler.fill", "#5E5CE6"],
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

export const ICON_GROUPS = [
  "Food & drink",
  "Shopping",
  "Home & bills",
  "Transport",
  "Travel",
  "Health",
  "Family & pets",
  "Sport & hobbies",
  "Tech & work",
  "Money",
  "Education & documents",
] as const;

export type IconGroup = (typeof ICON_GROUPS)[number];

export interface CatalogIcon { name: string; group: IconGroup; keywords: string }

/**
 * Icon catalogue for the icon picker. Every symbol is available on iOS 18 (SF Symbols 6.0 or
 * earlier), which is the app's own minimum — `test/icons.test.ts` checks every name against the
 * list shipped with `sf-symbols-typescript`, because a name with a typo in it renders as nothing
 * at all and TypeScript cannot catch it (`expo-symbols` takes a plain string).
 *
 * `group` is what the picker shows as a heading while nothing is typed; `keywords` is what
 * `searchIcons` matches, in English, Polish and Ukrainian, because a category is named in the
 * language its owner thinks in.
 */
export const ICON_CATALOG: CatalogIcon[] = [
  // Food & drink
  { name: "fork.knife", group: "Food & drink", keywords: "restaurant food dinner eat lunch meal ресторан їжа restauracja" },
  { name: "takeoutbag.and.cup.and.straw.fill", group: "Food & drink", keywords: "fast food takeout takeaway delivery street food фастфуд доставка" },
  { name: "cup.and.saucer.fill", group: "Food & drink", keywords: "coffee cafe tea drink espresso кава кафе kawa" },
  { name: "mug.fill", group: "Food & drink", keywords: "coffee tea hot drink mug cocoa чай herbata" },
  { name: "wineglass.fill", group: "Food & drink", keywords: "wine alcohol bar drinks pub вино алкоголь alkohol" },
  { name: "birthday.cake.fill", group: "Food & drink", keywords: "birthday party cake celebration dessert торт тістечко" },
  { name: "carrot.fill", group: "Food & drink", keywords: "vegetables produce healthy food greengrocer овочі warzywa" },
  { name: "fish.fill", group: "Food & drink", keywords: "seafood fish market sushi риба ryba" },
  { name: "popcorn.fill", group: "Food & drink", keywords: "snacks cinema movie treats sweets снеки przekąski" },
  { name: "cart.fill", group: "Food & drink", keywords: "groceries supermarket shopping cart market продукти магазин zakupy" },
  { name: "basket.fill", group: "Food & drink", keywords: "shopping basket groceries market corner shop кошик koszyk" },
  { name: "drop.fill", group: "Food & drink", keywords: "water beverage drink bottled вода woda" },
  { name: "menucard.fill", group: "Food & drink", keywords: "menu restaurant dining bill меню" },
  { name: "frying.pan.fill", group: "Food & drink", keywords: "cooking kitchen home food готування kuchnia" },
  { name: "birthday.cake", group: "Food & drink", keywords: "bakery cake pastry sweets пекарня piekarnia" },
  { name: "cup.and.saucer", group: "Food & drink", keywords: "breakfast brunch coffee сніданок" },
  { name: "waterbottle.fill", group: "Food & drink", keywords: "water bottle drinks sport пляшка butelka" },
  { name: "takeoutbag.and.cup.and.straw", group: "Food & drink", keywords: "lunch canteen work meal обід lunch" },
  { name: "refrigerator.fill", group: "Food & drink", keywords: "groceries fridge home food холодильник lodówka" },
  // Shopping
  { name: "bag.fill", group: "Shopping", keywords: "shopping bag retail purchases покупки zakupy" },
  { name: "tshirt.fill", group: "Shopping", keywords: "clothes clothing fashion apparel одяг ubrania" },
  { name: "shoe.fill", group: "Shopping", keywords: "shoes footwear sneakers boots взуття buty" },
  { name: "handbag.fill", group: "Shopping", keywords: "handbag purse accessories bag сумка torebka" },
  { name: "gift.fill", group: "Shopping", keywords: "gift present birthday подарунок prezent" },
  { name: "giftcard.fill", group: "Shopping", keywords: "gift card voucher coupon подарункова картка" },
  { name: "sparkles", group: "Shopping", keywords: "misc one-time special irregular разове" },
  { name: "tag.fill", group: "Shopping", keywords: "general category tag label sale знижка" },
  { name: "shippingbox.fill", group: "Shopping", keywords: "parcel delivery online order package посилка paczka" },
  { name: "storefront.fill", group: "Shopping", keywords: "shop store retail boutique магазин sklep" },
  { name: "eyeglasses", group: "Shopping", keywords: "optician glasses eyewear vision окуляри okulary" },
  { name: "comb.fill", group: "Shopping", keywords: "beauty grooming hair salon краса uroda" },
  { name: "sofa.fill", group: "Shopping", keywords: "furniture living room home меблі meble" },
  { name: "lamp.floor.fill", group: "Shopping", keywords: "furniture lighting home decor лампа lampa" },
  { name: "washer.fill", group: "Shopping", keywords: "laundry washing machine appliance пральня pralnia" },
  { name: "bag.circle.fill", group: "Shopping", keywords: "marketplace second hand resale секонд" },
  { name: "cart.badge.plus", group: "Shopping", keywords: "weekly shop big shop великі покупки" },
  { name: "shippingbox", group: "Shopping", keywords: "returns parcel post повернення paczka" },
  { name: "scissors.badge.ellipsis", group: "Shopping", keywords: "tailor alterations repairs ательє krawiec" },
  { name: "sparkles.tv.fill", group: "Shopping", keywords: "electronics appliances техніка elektronika" },
  // Home & bills
  { name: "house.fill", group: "Home & bills", keywords: "home rent mortgage house дім житло dom mieszkanie" },
  { name: "key.fill", group: "Home & bills", keywords: "keys rent deposit real estate letting оренда wynajem" },
  { name: "bolt.fill", group: "Home & bills", keywords: "electricity utility power bill світло prąd" },
  { name: "lightbulb.fill", group: "Home & bills", keywords: "electricity lighting utility light світло żarówka" },
  { name: "flame.fill", group: "Home & bills", keywords: "gas heating fireplace utility газ опалення gaz" },
  { name: "thermometer", group: "Home & bills", keywords: "heating cooling temperature climate опалення ogrzewanie" },
  { name: "drop.triangle.fill", group: "Home & bills", keywords: "water bill plumbing utility вода woda" },
  { name: "trash.fill", group: "Home & bills", keywords: "waste garbage collection utility сміття śmieci" },
  { name: "wifi", group: "Home & bills", keywords: "internet broadband router utility інтернет internet" },
  { name: "antenna.radiowaves.left.and.right", group: "Home & bills", keywords: "phone mobile internet wifi telecom телефон зв'язок" },
  { name: "wrench.and.screwdriver.fill", group: "Home & bills", keywords: "repair maintenance tools handyman ремонт naprawa" },
  { name: "hammer.fill", group: "Home & bills", keywords: "construction repair diy tools ремонт remont" },
  { name: "paintbrush.fill", group: "Home & bills", keywords: "decorating painting renovation ремонт malowanie" },
  { name: "bed.double.fill", group: "Home & bills", keywords: "hotel bedroom furniture sleep спальня" },
  { name: "shower.fill", group: "Home & bills", keywords: "bathroom plumbing water ванна łazienka" },
  { name: "house.and.flag.fill", group: "Home & bills", keywords: "home real estate property нерухомість nieruchomość" },
  { name: "building.2.fill", group: "Home & bills", keywords: "office work company building офіс biuro" },
  { name: "sparkle", group: "Home & bills", keywords: "cleaning housekeeping tidy прибирання sprzątanie" },
  { name: "leaf.fill", group: "Home & bills", keywords: "nature eco green plants garden сад ogród" },
  { name: "house.circle.fill", group: "Home & bills", keywords: "household home general господарство gospodarstwo" },
  { name: "humidity.fill", group: "Home & bills", keywords: "water utility bill вода woda" },
  { name: "air.conditioner.horizontal.fill", group: "Home & bills", keywords: "air conditioning climate кондиціонер klimatyzacja" },
  { name: "chair.fill", group: "Home & bills", keywords: "furniture home меблі krzesło" },
  { name: "cabinet.fill", group: "Home & bills", keywords: "furniture storage home шафа szafa" },
  { name: "spigot.fill", group: "Home & bills", keywords: "plumbing water repairs сантехніка hydraulik" },
  { name: "hand.raised.fingers.spread.fill", group: "Home & bills", keywords: "cleaning help service послуги usługi" },
  // Transport
  { name: "car.fill", group: "Transport", keywords: "car auto taxi parking drive авто машина samochód" },
  { name: "fuelpump.fill", group: "Transport", keywords: "fuel petrol gas gasoline station бензин паливо paliwo" },
  { name: "bolt.car.fill", group: "Transport", keywords: "electric car charging ev зарядка ładowanie" },
  { name: "car.2.fill", group: "Transport", keywords: "carpool rideshare cars uber bolt" },
  { name: "parkingsign.circle.fill", group: "Transport", keywords: "parking fee garage паркінг parking" },
  { name: "bus.fill", group: "Transport", keywords: "bus transport public transit автобус autobus" },
  { name: "tram.fill", group: "Transport", keywords: "tram streetcar transit трамвай tramwaj" },
  { name: "train.side.front.car", group: "Transport", keywords: "train transport rail commute потяг pociąg" },
  { name: "bicycle", group: "Transport", keywords: "bike cycling transport велосипед rower" },
  { name: "scooter", group: "Transport", keywords: "scooter kick electric transport самокат hulajnoga" },
  { name: "figure.walk", group: "Transport", keywords: "walking commute exercise пішки" },
  { name: "ferry.fill", group: "Transport", keywords: "ferry boat water transport пором prom" },
  { name: "cablecar.fill", group: "Transport", keywords: "cable car ski lift transport підйомник" },
  { name: "airplane", group: "Transport", keywords: "flight travel airport plane літак samolot" },
  { name: "airplane.departure", group: "Transport", keywords: "flight departure airport travel виліт" },
  { name: "steeringwheel", group: "Transport", keywords: "driving lessons car rental водіння jazda" },
  { name: "road.lanes", group: "Transport", keywords: "toll motorway road trip дорога autostrada" },
  { name: "wrench.adjustable.fill", group: "Transport", keywords: "car service garage repair сервіс serwis" },
  { name: "car.side.fill", group: "Transport", keywords: "car ride commute авто auto" },
  { name: "engine.combustion.fill", group: "Transport", keywords: "car service engine repair двигун silnik" },
  { name: "tirepressure", group: "Transport", keywords: "tyres car service шини opony" },
  { name: "airplane.circle.fill", group: "Transport", keywords: "flights airline travel авіа lotnisko" },
  { name: "figure.walk.motion", group: "Transport", keywords: "commute walking exercise прогулянка spacer" },
  // Travel
  { name: "suitcase.fill", group: "Travel", keywords: "travel luggage business trip валіза walizka" },
  { name: "map.fill", group: "Travel", keywords: "travel navigation trip map карта mapa" },
  { name: "beach.umbrella.fill", group: "Travel", keywords: "vacation beach holiday відпустка wakacje" },
  { name: "mountain.2.fill", group: "Travel", keywords: "hiking mountains outdoors nature гори góry" },
  { name: "tent.fill", group: "Travel", keywords: "camping outdoors festival кемпінг namiot" },
  { name: "globe.europe.africa.fill", group: "Travel", keywords: "abroad international travel world за кордоном zagranica" },
  { name: "binoculars.fill", group: "Travel", keywords: "sightseeing tour excursion екскурсія wycieczka" },
  { name: "ticket.fill", group: "Travel", keywords: "tickets booking entry event квиток bilet" },
  { name: "building.columns.fill", group: "Travel", keywords: "bank savings deposit museum банк bank" },
  { name: "globe.desk.fill", group: "Travel", keywords: "travel world abroad подорожі podróże" },
  { name: "sun.max.fill", group: "Travel", keywords: "holiday summer weather відпустка wakacje" },
  { name: "snowflake", group: "Travel", keywords: "winter holiday ski зима zima" },
  { name: "building.2.crop.circle.fill", group: "Travel", keywords: "city break hotel місто miasto" },
  // Health
  { name: "cross.case.fill", group: "Health", keywords: "pharmacy medicine health first aid аптека apteka" },
  { name: "pills.fill", group: "Health", keywords: "medicine pills pharmacy health ліки leki" },
  { name: "stethoscope", group: "Health", keywords: "doctor medical health checkup лікар lekarz" },
  { name: "heart.fill", group: "Health", keywords: "charity donation love health серце" },
  { name: "heart.text.square.fill", group: "Health", keywords: "health record medical checkup обстеження badania" },
  { name: "bandage.fill", group: "Health", keywords: "first aid injury medical травма" },
  { name: "syringe.fill", group: "Health", keywords: "vaccine injection medical щеплення szczepienie" },
  { name: "cross.fill", group: "Health", keywords: "hospital pharmacy medical clinic лікарня szpital" },
  { name: "facemask.fill", group: "Health", keywords: "mask health protection маска maseczka" },
  { name: "brain.head.profile", group: "Health", keywords: "therapy psychology mental health терапія terapia" },
  { name: "mouth.fill", group: "Health", keywords: "dentist dental teeth стоматолог dentysta" },
  { name: "cross.vial.fill", group: "Health", keywords: "lab tests blood analysis аналізи badania" },
  { name: "figure.yoga", group: "Health", keywords: "yoga fitness wellness йога joga" },
  { name: "waveform.path.ecg", group: "Health", keywords: "health monitoring checkup клініка" },
  { name: "figure.strengthtraining.traditional", group: "Health", keywords: "gym training fitness тренування trening" },
  { name: "drop.degreesign.fill", group: "Health", keywords: "health tests clinic аналізи" },
  { name: "eye.fill", group: "Health", keywords: "optician eye test vision зір wzrok" },
  // Family & pets
  { name: "person.2.fill", group: "Family & pets", keywords: "family people relationship сім'я rodzina" },
  { name: "person.3.fill", group: "Family & pets", keywords: "group friends social event друзі znajomi" },
  { name: "figure.and.child.holdinghands", group: "Family & pets", keywords: "kids children baby family діти dzieci" },
  { name: "stroller.fill", group: "Family & pets", keywords: "baby stroller kids infant коляска wózek" },
  { name: "teddybear.fill", group: "Family & pets", keywords: "toys kids children baby іграшки zabawki" },
  { name: "pawprint.fill", group: "Family & pets", keywords: "pet cat dog animal тварини zwierzęta" },
  { name: "dog.fill", group: "Family & pets", keywords: "dog puppy pet vet собака pies" },
  { name: "cat.fill", group: "Family & pets", keywords: "cat kitten pet vet кіт kot" },
  { name: "hare.fill", group: "Family & pets", keywords: "pet rabbit animal кролик królik" },
  { name: "tortoise.fill", group: "Family & pets", keywords: "pet turtle animal черепаха żółw" },
  { name: "bird.fill", group: "Family & pets", keywords: "pet bird animal птах ptak" },
  { name: "fish", group: "Family & pets", keywords: "aquarium pet fish акваріум akwarium" },
  { name: "balloon.2.fill", group: "Family & pets", keywords: "party celebration gift свято impreza" },
  { name: "figure.2.and.child.holdinghands", group: "Family & pets", keywords: "family parents children родина" },
  { name: "figure.child.circle.fill", group: "Family & pets", keywords: "childcare nursery kids садок przedszkole" },
  { name: "gift.circle.fill", group: "Family & pets", keywords: "presents celebrations подарунки prezenty" },
  { name: "person.crop.circle.fill", group: "Family & pets", keywords: "personal me myself особисте osobiste" },
  // Sport & hobbies
  { name: "figure.run", group: "Sport & hobbies", keywords: "gym fitness sport running exercise біг bieganie" },
  { name: "dumbbell.fill", group: "Sport & hobbies", keywords: "gym weights fitness workout зал siłownia" },
  { name: "soccerball", group: "Sport & hobbies", keywords: "football soccer sport футбол piłka" },
  { name: "basketball.fill", group: "Sport & hobbies", keywords: "basketball sport баскетбол" },
  { name: "tennis.racket", group: "Sport & hobbies", keywords: "tennis sport racket теніс tenis" },
  { name: "tennisball.fill", group: "Sport & hobbies", keywords: "tennis ball sport" },
  { name: "figure.pool.swim", group: "Sport & hobbies", keywords: "swimming pool sport басейн basen" },
  { name: "figure.hiking", group: "Sport & hobbies", keywords: "hiking outdoors trekking похід wędrówka" },
  { name: "figure.skiing.downhill", group: "Sport & hobbies", keywords: "ski snowboard winter sport лижі narty" },
  { name: "figure.climbing", group: "Sport & hobbies", keywords: "climbing bouldering sport скелелазіння" },
  { name: "figure.dance", group: "Sport & hobbies", keywords: "dance classes hobby танці taniec" },
  { name: "paintpalette.fill", group: "Sport & hobbies", keywords: "art painting hobby craft мистецтво sztuka" },
  { name: "theatermasks.fill", group: "Sport & hobbies", keywords: "theatre drama performance театр teatr" },
  { name: "camera.fill", group: "Sport & hobbies", keywords: "photography camera hobby фото zdjęcia" },
  { name: "guitars.fill", group: "Sport & hobbies", keywords: "music instrument guitar hobby гітара gitara" },
  { name: "music.note", group: "Sport & hobbies", keywords: "music songs concert музика muzyka" },
  { name: "music.mic", group: "Sport & hobbies", keywords: "concert karaoke gig концерт koncert" },
  { name: "film.fill", group: "Sport & hobbies", keywords: "movie cinema film кіно kino" },
  { name: "tv.fill", group: "Sport & hobbies", keywords: "television entertainment streaming телевізор telewizor" },
  { name: "gamecontroller.fill", group: "Sport & hobbies", keywords: "games gaming videogames ігри gry" },
  { name: "dice.fill", group: "Sport & hobbies", keywords: "board games hobby fun настільні gry" },
  { name: "puzzlepiece.fill", group: "Sport & hobbies", keywords: "hobby puzzle games головоломка" },
  { name: "star.fill", group: "Sport & hobbies", keywords: "favorite fun entertainment wish хотілки" },
  { name: "moon.stars.fill", group: "Sport & hobbies", keywords: "nightlife bar club evening entertainment нічне життя" },
  { name: "scissors", group: "Sport & hobbies", keywords: "haircut barber salon beauty стрижка fryzjer" },
  { name: "book.fill", group: "Sport & hobbies", keywords: "education book course reading книга książka" },
  { name: "books.vertical.fill", group: "Sport & hobbies", keywords: "library books reading книжки biblioteka" },
  { name: "paintbrush.pointed.fill", group: "Sport & hobbies", keywords: "crafts handmade hobby diy рукоділля rękodzieło" },
  { name: "fireworks", group: "Sport & hobbies", keywords: "celebration festival new year свято" },
  { name: "flame.circle.fill", group: "Sport & hobbies", keywords: "calories fitness sport спорт" },
  { name: "baseball.fill", group: "Sport & hobbies", keywords: "baseball sport бейсбол" },
  { name: "volleyball.fill", group: "Sport & hobbies", keywords: "volleyball sport волейбол siatkówka" },
  { name: "skateboard.fill", group: "Sport & hobbies", keywords: "skateboard sport hobby скейт deskorolka" },
  { name: "surfboard.fill", group: "Sport & hobbies", keywords: "surfing watersport sport серфінг" },
  { name: "mic.fill", group: "Sport & hobbies", keywords: "podcast karaoke recording мікрофон" },
  { name: "ticket", group: "Sport & hobbies", keywords: "events shows concerts квитки bilety" },
  // Tech & work
  { name: "laptopcomputer", group: "Tech & work", keywords: "tech computer work laptop ноутбук laptop" },
  { name: "desktopcomputer", group: "Tech & work", keywords: "computer tech electronics комп'ютер komputer" },
  { name: "iphone", group: "Tech & work", keywords: "phone handset device mobile телефон telefon" },
  { name: "headphones", group: "Tech & work", keywords: "audio music tech electronics навушники słuchawki" },
  { name: "keyboard", group: "Tech & work", keywords: "computer accessories tech клавіатура klawiatura" },
  { name: "printer.fill", group: "Tech & work", keywords: "printer office supplies принтер drukarka" },
  { name: "externaldrive.fill", group: "Tech & work", keywords: "storage backup hardware диск dysk" },
  { name: "icloud.fill", group: "Tech & work", keywords: "cloud storage subscription хмара chmura" },
  { name: "briefcase.fill", group: "Tech & work", keywords: "work job business office робота praca" },
  { name: "person.crop.rectangle.fill", group: "Tech & work", keywords: "id badge document identification посвідчення" },
  { name: "building.fill", group: "Tech & work", keywords: "office building generic government будівля budynek" },
  { name: "lock.fill", group: "Tech & work", keywords: "security safe subscription vpn безпека" },
  { name: "wrench.and.screwdriver", group: "Tech & work", keywords: "services support repairs послуги usługi" },
  { name: "cube.box.fill", group: "Tech & work", keywords: "equipment supplies stock обладнання sprzęt" },
  { name: "paperclip", group: "Tech & work", keywords: "office supplies stationery канцтовари" },
  { name: "display", group: "Tech & work", keywords: "monitor screen electronics монітор monitor" },
  { name: "applewatch", group: "Tech & work", keywords: "watch wearable device годинник zegarek" },
  { name: "airpods.gen3", group: "Tech & work", keywords: "earphones audio device навушники" },
  { name: "simcard.fill", group: "Tech & work", keywords: "sim mobile plan telecom сім-карта karta sim" },
  { name: "network", group: "Tech & work", keywords: "internet hosting domain хостинг domena" },
  { name: "chart.bar.fill", group: "Tech & work", keywords: "reports analytics work статистика statystyki" },
  // Money
  { name: "banknote.fill", group: "Money", keywords: "salary income cash payroll зарплата wynagrodzenie" },
  { name: "banknote", group: "Money", keywords: "cash money готівка gotówka" },
  { name: "creditcard.fill", group: "Money", keywords: "credit card payment картка karta" },
  { name: "wallet.pass.fill", group: "Money", keywords: "wallet card pass loyalty гаманець portfel" },
  { name: "dollarsign.circle.fill", group: "Money", keywords: "money currency dollar finance долар dolar" },
  { name: "eurosign.circle.fill", group: "Money", keywords: "money currency euro finance євро euro" },
  { name: "chart.line.uptrend.xyaxis", group: "Money", keywords: "investment stocks growth trading інвестиції inwestycje" },
  { name: "chart.pie.fill", group: "Money", keywords: "budget allocation finance бюджет budżet" },
  { name: "percent", group: "Money", keywords: "tax discount interest rate податок podatek" },
  { name: "shield.fill", group: "Money", keywords: "insurance protection safety страхування ubezpieczenie" },
  { name: "arrow.left.arrow.right", group: "Money", keywords: "transfer exchange move money переказ przelew" },
  { name: "arrow.uturn.left", group: "Money", keywords: "refund return chargeback повернення zwrot" },
  { name: "hand.thumbsup.fill", group: "Money", keywords: "bonus reward cashback бонус" },
  { name: "repeat", group: "Money", keywords: "subscription recurring monthly підписка subskrypcja" },
  { name: "pin.fill", group: "Money", keywords: "fixed recurring pinned постійні stałe" },
  { name: "calendar", group: "Money", keywords: "monthly bills schedule календар kalendarz" },
  { name: "hourglass", group: "Money", keywords: "pending waiting instalment розстрочка rata" },
  { name: "scalemass.fill", group: "Money", keywords: "fees charges commission комісія prowizja" },
  { name: "dollarsign.arrow.circlepath", group: "Money", keywords: "loan debt repayment borrowing борг dług" },
  { name: "creditcard.and.123", group: "Money", keywords: "card fees banking банк bank" },
  { name: "building.columns.circle.fill", group: "Money", keywords: "bank branch banking банк bank" },
  { name: "bitcoinsign.circle.fill", group: "Money", keywords: "crypto bitcoin investment крипта krypto" },
  { name: "arrow.down.circle.fill", group: "Money", keywords: "income received deposit надходження wpływ" },
  { name: "arrow.up.circle.fill", group: "Money", keywords: "expense paid outgoing витрата wydatek" },
  { name: "exclamationmark.triangle.fill", group: "Money", keywords: "fine penalty overdue штраф mandat" },
  // Education & documents
  { name: "graduationcap.fill", group: "Education & documents", keywords: "education school university tuition навчання studia" },
  { name: "pencil.and.ruler.fill", group: "Education & documents", keywords: "school supplies education stationery канцтовари przybory" },
  { name: "backpack.fill", group: "Education & documents", keywords: "school backpack bag education рюкзак plecak" },
  { name: "doc.text.fill", group: "Education & documents", keywords: "documents legal paperwork документи dokumenty" },
  { name: "checkmark.seal.fill", group: "Education & documents", keywords: "government certificate official document сертифікат" },
  { name: "signature", group: "Education & documents", keywords: "contract legal agreement договір umowa" },
  { name: "newspaper.fill", group: "Education & documents", keywords: "news subscription magazine media новини gazeta" },
  { name: "envelope.fill", group: "Education & documents", keywords: "post mail letters пошта poczta" },
  { name: "bubble.left.and.bubble.right.fill", group: "Education & documents", keywords: "translation lessons language уроки lekcje" },
  { name: "globe", group: "Education & documents", keywords: "language course internet мова język" },
  { name: "play.rectangle.fill", group: "Education & documents", keywords: "streaming subscription video стрімінг" },
  { name: "questionmark.folder.fill", group: "Education & documents", keywords: "uncategorised other unknown інше inne" },
  { name: "text.book.closed.fill", group: "Education & documents", keywords: "textbook course study підручник podręcznik" },
  { name: "studentdesk", group: "Education & documents", keywords: "school class tuition школа szkoła" },
  { name: "pencil", group: "Education & documents", keywords: "stationery notes school олівець ołówek" },
  { name: "folder.fill", group: "Education & documents", keywords: "documents files archive теки foldery" },
  { name: "creditcard.circle.fill", group: "Education & documents", keywords: "licence permit fee дозвіл pozwolenie" },
  { name: "flag.fill", group: "Education & documents", keywords: "visa residency permit віза wiza" },
  { name: "bookmark.fill", group: "Education & documents", keywords: "saved marked other закладка zakładka" },
];

/**
 * Fold a word down to what a search should match: case and accents off, so "Kawa", "kawa" and
 * "kawą" are one word. Polish ł has no decomposed form, so it is mapped by hand.
 */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0142/g, "l").toLowerCase();
}

/** Where a word matched, smaller being better; null when it did not match at all. */
function rankWord(word: string, name: string, keys: string[]): number | null {
  // A whole word, either a keyword or one of the symbol name's dotted parts ("car.fill" → "car",
  // "fill"). This is what puts `car.fill` above `carrot.fill` for "car": both names begin with
  // those three letters, but only one of them *is* them.
  const parts = name.split(".");
  if (keys.includes(word) || parts.includes(word)) return 0;
  if (keys.some((k) => k.startsWith(word)) || parts.some((part) => part.startsWith(word))) return 1;
  if (name.includes(word) || keys.some((k) => k.includes(word))) return 2;
  return null;
}

/**
 * The catalogue filtered by a search box. Every word has to match something — "car wash" finds
 * what both words describe rather than everything to do with cars — and whole words and prefixes
 * are ranked above a substring hit anywhere, so "car" leads with `car.fill` instead of burying it
 * under `carrot.fill`. A blank query is the whole catalogue, in catalogue order.
 */
export function searchIcons(query: string, catalog: readonly CatalogIcon[] = ICON_CATALOG): CatalogIcon[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...catalog];
  const hits: { icon: CatalogIcon; score: number }[] = [];
  for (const icon of catalog) {
    const name = fold(icon.name);
    const keys = fold(icon.keywords).split(/\s+/);
    let score = 0;
    for (const w of words) {
      const r = rankWord(w, name, keys);
      if (r === null) { score = -1; break; }
      score += r;
    }
    if (score >= 0) hits.push({ icon, score });
  }
  // Sort is stable, so equally good matches keep their catalogue order (and their grouping with it).
  return hits.sort((a, b) => a.score - b.score).map((h) => h.icon);
}

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
