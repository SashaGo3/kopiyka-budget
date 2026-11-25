/**
 * Suggested translations for categories you named yourself — "Cats" is «Коти», "Car wash" is «Мийка
 * авто». Only ever a *suggestion*: Settings → Categories → Names in your language offers them, and a
 * name is stored (`categories.names`, v27, DATA.md rule 16) only when you save it. Nothing is
 * translated behind your back, and a word this list gets wrong costs one edit.
 *
 * Each entry is the same thing in every language: the first word of each list is what is suggested,
 * the rest are other ways of saying it that are recognised (and other languages a name may be written
 * in — "Rower" is Polish for a bike). Matching is whole-name, case and spacing aside; a name made of
 * parts — "Car (General)", "Travel/Leisure" — is translated part by part when every part is known.
 */
import { isPresetName } from "./presets";
import type { SqlDriver } from "./db";
import { getMeta, setMeta } from "./schema";

type Entry = Record<string, string[]>;
const E = (en: string | string[], uk: string | string[]): Entry => ({ en: ([] as string[]).concat(en), uk: ([] as string[]).concat(uk) });

export const COMMON_NAMES: Entry[] = [
  // Food
  E(["Food"], ["Їжа"]), E(["Groceries"], ["Продукти"]), E(["Supermarket", "Supermarkets"], ["Супермаркет", "Супермаркети"]),
  E(["Eating out", "Eating-out", "Dining out"], ["Їжа поза домом", "Їжа поза домом"]), E(["Restaurants", "Restaurant"], ["Ресторани", "Ресторан"]),
  E(["Cafe", "Cafes", "Café", "Cafés", "Coffee"], ["Кафе", "Кава"]), E(["Lunch", "Lunches"], ["Обіди", "Обід"]), E(["Snacks"], ["Перекуси"]),
  E(["Delivery", "Food delivery"], ["Доставка", "Доставка їжі"]), E(["Alcohol", "Drinks"], ["Алкоголь", "Напої"]), E(["Bakery"], ["Пекарня"]),
  E(["Supplements", "Vitamins", "Vitamins & supplements"], ["Добавки", "Вітаміни"]),
  // Home and bills
  E(["Fixed", "Fixed costs", "Fixed expenses"], ["Фіксовані", "Фіксовані витрати"]), E(["Payments"], ["Платежі"]), E(["Bills"], ["Рахунки"]),
  E(["Rent"], ["Оренда"]), E(["Mortgage"], ["Іпотека"]), E(["Utilities"], ["Комуналка", "Комунальні"]), E(["Electricity"], ["Електрика", "Світло"]),
  E(["Water"], ["Вода"]), E(["Gas"], ["Газ"]), E(["Heating"], ["Опалення"]), E(["Internet"], ["Інтернет"]), E(["Phone", "Mobile"], ["Телефон", "Мобільний"]),
  E(["Subscriptions", "Subscription"], ["Підписки", "Підписка"]), E(["Yearly subscriptions", "Annual subscriptions"], ["Річні підписки"]),
  E(["Monthly subscriptions"], ["Щомісячні підписки"]), E(["Insurance"], ["Страхування"]), E(["Taxes", "Tax"], ["Податки", "Податок"]),
  E(["PIT"], ["Податок PIT"]), E(["ZUS"], ["Внески ZUS"]), E(["VAT"], ["ПДВ"]),
  E(["Accountant", "Accounting"], ["Бухгалтер", "Бухгалтерія"]), E(["Bank fees", "Bank fee", "Fees", "Commissions"], ["Банківські комісії", "Комісії"]),
  E(["Legal", "Lawyer"], ["Юридичні", "Юрист"]), E(["Loans", "Loan", "Credit"], ["Кредити", "Кредит"]),
  E(["Home", "House", "Household"], ["Дім", "Господарство"]), E(["Furniture"], ["Меблі"]), E(["Repairs", "Repair"], ["Ремонт"]),
  E(["Maintenance", "Upkeep"], ["Підтримка", "Обслуговування"]), E(["Cleaning"], ["Прибирання"]), E(["Appliances"], ["Техніка"]),
  // Transport
  E(["Transport", "Transportation"], ["Транспорт"]), E(["Car", "Auto", "Samochód"], ["Авто", "Машина"]), E(["Fuel", "Petrol", "Gas station"], ["Пальне", "Бензин"]),
  E(["Car maintenance", "Car service", "Car repair"], ["Обслуговування авто"]), E(["Car parking", "Parking"], ["Паркування", "Парковка"]),
  E(["Car wash"], ["Мийка авто"]), E(["Car insurance"], ["Страхування авто"]), E(["Taxi", "Taxis"], ["Таксі"]),
  E(["Public transport", "Public transportation"], ["Громадський транспорт"]), E(["Bicycle", "Bike", "Rower", "Bike & scooter"], ["Велосипед"]),
  E(["Scooter"], ["Самокат"]), E(["Flights", "Flight", "Plane tickets"], ["Авіаквитки"]), E(["Train", "Trains"], ["Потяги", "Потяг"]),
  E(["Tolls"], ["Платні дороги"]),
  // Health and personal
  E(["Health", "Healthcare", "Medical"], ["Здоровʼя", "Здоров'я", "Медицина"]), E(["Doctor", "Doctors"], ["Лікар", "Лікарі"]),
  E(["Dentist"], ["Стоматолог"]), E(["Pharmacy", "Medicine", "Medicines"], ["Аптека", "Ліки"]), E(["Sport", "Sports", "Gym", "Fitness"], ["Спорт", "Спортзал"]),
  E(["Haircut", "Hairdresser", "Barber"], ["Стрижка", "Перукар"]), E(["Beauty", "Cosmetics"], ["Краса", "Косметика"]),
  E(["Personal", "Personal care"], ["Особисте", "Догляд"]), E(["Clothes", "Clothing"], ["Одяг"]), E(["Shoes"], ["Взуття"]),
  E(["Essentials"], ["Необхідне"]), E(["Purchases", "Shopping"], ["Покупки"]), E(["Electronics", "Gadgets"], ["Електроніка", "Гаджети"]),
  E(["Cash"], ["Готівка"]), E(["Therapy", "Psychologist"], ["Терапія", "Психолог"]),
  // Family
  E(["Family"], ["Родина", "Сімʼя"]), E(["Child", "Kid", "Baby"], ["Дитина"]), E(["Children", "Kids", "Kids & baby"], ["Діти"]),
  E(["Pregnancy"], ["Вагітність"]), E(["School"], ["Школа"]), E(["Kindergarten", "Daycare"], ["Садочок"]),
  E(["Pets", "Pet"], ["Тварини", "Улюбленці"]), E(["Cats", "Cat"], ["Коти", "Кіт"]), E(["Dogs", "Dog"], ["Собаки", "Собака"]), E(["Vet"], ["Ветеринар"]),
  E(["Presents", "Gifts", "Gift", "Present"], ["Подарунки", "Подарунок"]), E(["Charity", "Donations"], ["Благодійність", "Донати"]),
  // Fun and learning
  E(["Fun", "Entertainment"], ["Розваги", "Дозвілля"]), E(["Travel", "Trips", "Travelling", "Traveling"], ["Подорожі"]),
  E(["Leisure", "Rest"], ["Відпочинок", "Дозвілля"]), E(["Holidays", "Vacation", "Vacations"], ["Відпустка"]), E(["Hotels", "Hotel", "Accommodation"], ["Готелі", "Житло"]),
  E(["Hobbies", "Hobby"], ["Хобі"]), E(["Books"], ["Книги"]), E(["Games"], ["Ігри"]), E(["Movies", "Cinema"], ["Кіно"]),
  E(["Music"], ["Музика"]), E(["Concerts"], ["Концерти"]), E(["Wishes", "Wishlist"], ["Бажання"]),
  E(["Education", "Learning"], ["Освіта", "Навчання"]), E(["Courses", "Course"], ["Курси", "Курс"]), E(["Lessons"], ["Уроки"]),
  E(["Polish lessons"], ["Уроки польської"]), E(["English lessons"], ["Уроки англійської"]), E(["Language lessons"], ["Уроки мов"]),
  // Kinds of spending
  E(["One-time", "One-off", "One time"], ["Разові"]), E(["Irregular"], ["Нерегулярні"]), E(["Regular"], ["Регулярні"]),
  E(["General", "Other", "Misc", "Miscellaneous"], ["Загальне", "Інше"]), E(["Unknown", "Uncategorized"], ["Невідомо", "Без категорії"]),
  E(["To sort", "Figure it out", "To figure out"], ["Розібратися"]), E(["I don't know", "Don't know", "No idea"], ["Не знаю"]),
  E(["Savings", "Saving"], ["Заощадження"]), E(["Investments", "Investing"], ["Інвестиції"]), E(["Emergency fund"], ["Резервний фонд"]),
  // Income
  E(["Income"], ["Доходи"]), E(["Salary", "Wages"], ["Зарплата"]), E(["Refunds", "Refund", "Returns"], ["Повернення"]),
  E(["Bonus", "Bonuses"], ["Бонуси", "Премія"]), E(["Interest"], ["Відсотки"]), E(["Freelance"], ["Фриланс"]), E(["Other income"], ["Інші доходи"]),
];

const norm = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[’ʼ`]/g, "'").toLocaleLowerCase();

/** Every name, in every language, to the entry it belongs to. */
let index: Map<string, Entry> | null = null;
function lookup(name: string): Entry | undefined {
  if (!index) {
    index = new Map();
    for (const e of COMMON_NAMES) for (const names of Object.values(e)) for (const n of names) if (!index.has(norm(n))) index.set(norm(n), e);
  }
  return index.get(norm(name));
}

/** How `name` is said in `lang`, whole or part by part, or null when this list does not know it. */
export function suggestName(name: string, lang: string): string | null {
  const whole = lookup(name)?.[lang]?.[0];
  if (whole) return whole;
  // "Car (General)", "Travel/Leisure"; "Ola Wishes" is not one: every part has to be known.
  const parts = name.trim().split(/(\s*\/\s*|\s*\(\s*|\s*\)\s*|\s+[-–—&+]\s+|\s*,\s*)/);
  if (parts.filter((p, i) => i % 2 === 0 && p.trim()).length < 2) return null;
  let out = "";
  const said = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i % 2 === 1 || !p.trim()) { out += p; continue; }
    const word = lookup(p)?.[lang]?.[0];
    if (!word) return null;
    // "Rower (Bicycle)" is one thing said twice: once is enough.
    if (said.has(word)) return [...said].length === 1 && parts.filter((x, j) => j % 2 === 0 && x.trim()).length === 2 ? word : null;
    said.add(word);
    // A part after the first is lower case, as it would be written: "Авто (загальне)" — unless it
    // is shouting on purpose ("I DON'T KNOW") or an acronym.
    const loud = p === p.toLocaleUpperCase() && /\p{L}{2}/u.test(p);
    out += !out.trim() ? word : loud ? word.toLocaleUpperCase(lang) : word.charAt(0).toLocaleLowerCase(lang) + word.slice(1);
  }
  return out.trim();
}

/**
 * Is `name` written in `lang`, as far as a name can tell? Cyrillic is Ukrainian, any other letters
 * are English — the two languages the app speaks. A name with no letters ("2024") is in every one.
 * What decides whether a category is offered a translation at all: one named in the language the
 * app is in now has nothing to translate.
 */
export function nameLooksIn(name: string, lang: string): boolean {
  const cyr = /[Ѐ-ӿ]/.test(name), latin = /[A-Za-zÀ-ɏ]/.test(name);
  if (!cyr && !latin) return true;
  return lang === "uk" ? cyr : !cyr;
}

/** A category named by its user — not a ready-made one still under the preset's name — in another language than `lang`. */
export function wantsTranslation(c: { name: string; preset?: string | null }, lang: string): boolean {
  if (c.preset && isPresetName(c.preset, c.name)) return false;
  return !nameLooksIn(c.name, lang);
}

/**
 * The categories already looked at on Names in <language> (meta `category_names_seen`, JSON ids).
 * Saving there marks every category it listed; the way in is offered again only when a category
 * named in another language turns up that is not on the list — a new one — and the editor is how
 * any one of the others is changed later. A preference, so it travels with backups (DATA.md rule 7).
 */
export function getCategoryNamesSeen(db: SqlDriver): Set<string> {
  try {
    const v: unknown = JSON.parse(getMeta(db, "category_names_seen") ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch { return new Set(); }
}

export function markCategoryNamesSeen(db: SqlDriver, ids: string[]): void {
  const seen = getCategoryNamesSeen(db);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) setMeta(db, "category_names_seen", JSON.stringify([...seen]));
}
