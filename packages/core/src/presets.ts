/**
 * Ready-made categories for a fresh install: folders with categories, icons, colours and a
 * description each (the receipt scanner matches against it). Generalised from a real
 * household budget; the user renames or prunes later in Settings.
 */
import type { SqlDriver } from "./db";
import type { Category } from "./models";
import { createCategory, listRows } from "./repo";

export interface PresetCategory { name: string; icon: string; description: string }
export interface PresetFolder { name: string; icon: string; color: string; kind: "expense" | "income"; categories: PresetCategory[] }

export const CATEGORY_PRESET: PresetFolder[] = [
  { name: "Food", icon: "cart.fill", color: "#FF9F0A", kind: "expense", categories: [
    { name: "Groceries", icon: "cart.fill", description: "supermarket, grocery store, market, bakery, food shopping, Biedronka, Lidl, Żabka" },
    { name: "Restaurants & cafés", icon: "fork.knife", description: "eating out, restaurant, café, bar, lunch, dinner, takeaway, delivery, pizza, sushi" },
    { name: "Coffee & snacks", icon: "cup.and.saucer.fill", description: "coffee to go, snack, ice cream, pastry, drinks on the go" },
  ] },
  { name: "Shopping", icon: "bag.fill", color: "#FF375F", kind: "expense", categories: [
    { name: "Household", icon: "bag.fill", description: "household goods, cleaning, toiletries, drugstore, Rossmann, kitchen items" },
    { name: "Clothes & shoes", icon: "tshirt.fill", description: "clothing, shoes, accessories, fashion" },
    { name: "Electronics", icon: "gamecontroller.fill", description: "electronics, gadgets, computer, phone, cables, appliances" },
    { name: "Wishes", icon: "star.fill", description: "things wanted rather than needed, treats, impulse buys" },
  ] },
  { name: "Home", icon: "house.fill", color: "#8E8E93", kind: "expense", categories: [
    { name: "Rent", icon: "house.fill", description: "rent, mortgage, housing payment" },
    { name: "Utilities", icon: "bolt.fill", description: "electricity, gas, water, heating, waste" },
    { name: "Internet & phone", icon: "antenna.radiowaves.left.and.right", description: "internet, mobile plan, phone bill, TV" },
    { name: "Furniture & repairs", icon: "wrench.and.screwdriver.fill", description: "furniture, IKEA, home improvement, repairs, tools, decor" },
  ] },
  { name: "Transport", icon: "car.fill", color: "#30D158", kind: "expense", categories: [
    { name: "Car", icon: "car.fill", description: "car service, parts, parking, tolls, car wash, insurance for the car" },
    { name: "Fuel", icon: "fuelpump.fill", description: "petrol, diesel, fuel, gas station, Orlen, Shell, BP, charging" },
    { name: "Public transport", icon: "bus.fill", description: "bus, tram, metro, train ticket, monthly pass" },
    { name: "Taxi", icon: "car.fill", description: "taxi, Uber, Bolt, ride" },
  ] },
  { name: "Health", icon: "cross.case.fill", color: "#FF2D55", kind: "expense", categories: [
    { name: "Pharmacy", icon: "cross.case.fill", description: "pharmacy, medicine, drugs, apteka" },
    { name: "Doctor", icon: "heart.fill", description: "doctor, dentist, clinic, medical visit, tests" },
    { name: "Vitamins & supplements", icon: "leaf.fill", description: "vitamins, supplements, protein" },
    { name: "Gym & sport", icon: "figure.run", description: "gym membership, fitness, sports, swimming, yoga, equipment" },
  ] },
  { name: "Personal", icon: "scissors", color: "#BF5AF2", kind: "expense", categories: [
    { name: "Haircut & beauty", icon: "scissors", description: "haircut, barber, hairdresser, cosmetics, beauty salon, nails" },
    { name: "Education", icon: "book.fill", description: "courses, language lessons, books, tuition, school" },
    { name: "Hobbies", icon: "sparkles", description: "hobby, crafts, music, games, sports gear" },
  ] },
  { name: "Bills", icon: "doc.text.fill", color: "#FFD60A", kind: "expense", categories: [
    { name: "Subscriptions", icon: "repeat", description: "subscription, Netflix, Spotify, iCloud, apps, streaming, membership" },
    { name: "Insurance", icon: "shield.fill", description: "insurance, health insurance, life insurance" },
    { name: "Taxes & fees", icon: "percent", description: "tax, government fees, bank fees, fines" },
  ] },
  { name: "Fun & travel", icon: "airplane", color: "#0A84FF", kind: "expense", categories: [
    { name: "Entertainment", icon: "film.fill", description: "cinema, concert, theatre, events, nightlife, tickets" },
    { name: "Travel", icon: "airplane", description: "flights, hotel, booking, holiday, trip, Airbnb" },
    { name: "Presents", icon: "gift.fill", description: "gifts, presents, flowers, celebration" },
  ] },
  { name: "Family", icon: "person.2.fill", color: "#FF9F0A", kind: "expense", categories: [
    { name: "Kids & baby", icon: "figure.and.child.holdinghands", description: "baby, kids, toys, diapers, childcare, school supplies" },
    { name: "Pets", icon: "pawprint.fill", description: "pet food, vet, cat, dog, litter" },
  ] },
  { name: "Savings", icon: "building.columns.fill", color: "#34C759", kind: "expense", categories: [
    { name: "Savings", icon: "building.columns.fill", description: "money set aside, savings deposit" },
    { name: "Investments", icon: "chart.line.uptrend.xyaxis", description: "investments, stocks, ETF, crypto, bonds" },
  ] },
  { name: "Income", icon: "banknote.fill", color: "#34C759", kind: "income", categories: [
    { name: "Salary", icon: "banknote.fill", description: "salary, wages, payroll" },
    { name: "Freelance", icon: "creditcard.fill", description: "freelance, side income, invoices" },
    { name: "Gifts & refunds", icon: "gift.fill", description: "money received as a gift, refund, cashback, reimbursement" },
    { name: "Other income", icon: "banknote", description: "interest, dividends, selling things, other income" },
  ] },
];

export function presetCounts(): { folders: number; categories: number } {
  return { folders: CATEGORY_PRESET.length, categories: CATEGORY_PRESET.reduce((n, f) => n + f.categories.length, 0) };
}

/** Create the preset. Folders and categories whose name already exists (case-insensitive) are reused, so running twice adds nothing. */
export function seedCategories(db: SqlDriver): { created: number; folders: Category[] } {
  const existing = listRows(db, "categories", "deleted=0");
  const byKey = new Map(existing.map((c) => [`${c.parent_id ?? ""}|${c.name.toLowerCase()}`, c]));
  let created = 0, sort = existing.length;
  const folders: Category[] = [];
  db.transaction(() => {
    for (const f of CATEGORY_PRESET) {
      let folder = byKey.get(`|${f.name.toLowerCase()}`);
      if (!folder) { folder = createCategory(db, { name: f.name, parent_id: null, icon: f.icon, color: f.color, kind: f.kind, sort: sort++ }); byKey.set(`|${f.name.toLowerCase()}`, folder); created++; }
      folders.push(folder);
      for (const c of f.categories) {
        const key = `${folder.id}|${c.name.toLowerCase()}`;
        if (byKey.has(key)) continue;
        byKey.set(key, createCategory(db, { name: c.name, parent_id: folder.id, icon: c.icon, color: f.color, kind: f.kind, sort: sort++, description: c.description }));
        created++;
      }
    }
  });
  return { created, folders };
}
