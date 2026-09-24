import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { MIGRATIONS, migrate } from "../src/schema";
import { createCategory, getRow, listRows } from "../src/repo";
import { exportBackup, importBackup } from "../src/backup";
import {
  applyImportance, categoryImportance, coveredCategoryIds, importanceAffected, importanceMarks,
  markableCategories, markableLeaves, unmarkedCount,
} from "../src/importance";
import type { Category } from "../src/models";

function fresh() {
  const db = openBunDb();
  migrate(db);
  return db;
}
const cats = (db: ReturnType<typeof fresh>) => listRows(db, "categories", "deleted=0") as Category[];

describe("the resolver", () => {
  test("a category inherits its folder's answer, its own mark wins", () => {
    const db = fresh();
    const subs = createCategory(db, { name: "Subscriptions", importance: 1 });
    const netflix = createCategory(db, { name: "Netflix", parent_id: subs.id });
    const phone = createCategory(db, { name: "Phone", parent_id: subs.id, importance: 3 });
    const level = categoryImportance(cats(db));
    expect(level.get(netflix.id)).toBe(1); // nothing of its own: the folder answers
    expect(level.get(phone.id)).toBe(3);   // its own mark wins
    expect(level.get(subs.id)).toBe(1);
  });

  test("a category added to a marked folder later is already answered", () => {
    const db = fresh();
    const subs = createCategory(db, { name: "Subscriptions", importance: 1 });
    const added = createCategory(db, { name: "Some new app", parent_id: subs.id });
    expect(categoryImportance(cats(db)).get(added.id)).toBe(1);
    expect(unmarkedCount(markableCategories(db))).toBe(0);
  });

  test("an unmarked folder leaves its categories unmarked", () => {
    const db = fresh();
    const food = createCategory(db, { name: "Food" });
    const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
    expect(categoryImportance(cats(db)).get(coffee.id)).toBe(0);
    expect(unmarkedCount(markableCategories(db))).toBe(1); // the folder is not filed into, so it is not counted
  });
});

describe("what the flow asks about", () => {
  test("income and archived categories are left out, folders are not leaves", () => {
    const db = fresh();
    const food = createCategory(db, { name: "Food" });
    const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
    const rent = createCategory(db, { name: "Rent" });
    createCategory(db, { name: "Salary", kind: "income" });
    createCategory(db, { name: "Old habit", archived: 1 });
    const gone = createCategory(db, { name: "Retired folder", archived: 1 });
    createCategory(db, { name: "Inside it", parent_id: gone.id });
    const asked = markableCategories(db);
    expect(asked.map((c) => c.name).sort()).toEqual(["Coffee", "Food", "Rent"]);
    // A folder is never filed into, so it is not one of the things being ranked.
    expect(markableLeaves(asked).map((c) => c.id).sort()).toEqual([coffee.id, rent.id].sort());
  });

  test("a picked folder stands for every category inside it", () => {
    const db = fresh();
    const food = createCategory(db, { name: "Food" });
    const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
    const lunch = createCategory(db, { name: "Lunch", parent_id: food.id });
    const rent = createCategory(db, { name: "Rent" });
    const asked = markableCategories(db);
    expect([...coveredCategoryIds(asked, [food.id, rent.id])].sort()).toEqual([coffee.id, lunch.id, rent.id].sort());
  });
});

describe("two questions, and medium is what is left", () => {
  function world() {
    const db = fresh();
    const home = createCategory(db, { name: "Home" });
    const rent = createCategory(db, { name: "Rent", parent_id: home.id });
    const power = createCategory(db, { name: "Power", parent_id: home.id });
    const fun = createCategory(db, { name: "Fun" });
    const games = createCategory(db, { name: "Games", parent_id: fun.id });
    const bars = createCategory(db, { name: "Bars", parent_id: fun.id });
    const food = createCategory(db, { name: "Food" }); // childless top-level: an ordinary category
    return { db, home, rent, power, fun, games, bars, food };
  }

  test("everything neither answer claimed is Medium", () => {
    const { db, home, fun, food } = world();
    const marks = importanceMarks(markableCategories(db), [home.id], [fun.id]);
    expect(marks.get(home.id)).toBe(3);
    expect(marks.get(fun.id)).toBe(1);
    expect(marks.get(food.id)).toBe(2); // never asked about, so it is one of the things in between
  });

  test("a whole folder is marked on the folder and its categories left to inherit", () => {
    const { db, home, rent, power } = world();
    const marks = importanceMarks(markableCategories(db), [home.id], []);
    expect(marks.get(home.id)).toBe(3);
    // Stamping the children would freeze them against the folder ever changing its mind.
    expect(marks.get(rent.id)).toBe(0);
    expect(marks.get(power.id)).toBe(0);
    applyImportance(db, marks);
    const level = categoryImportance(cats(db));
    expect(level.get(rent.id)).toBe(3);
    expect(level.get(power.id)).toBe(3);
  });

  test("a folder whose categories disagree keeps no mark of its own", () => {
    const { db, home, rent, power } = world();
    const marks = importanceMarks(markableCategories(db), [rent.id], [power.id]);
    expect(marks.get(rent.id)).toBe(3);
    expect(marks.get(power.id)).toBe(1);
    // Not 2: a folder that took a side would quietly answer for the next category added to it.
    expect(marks.get(home.id)).toBe(0);
  });

  test("High wins a category that somehow appears in both answers", () => {
    const { db, food } = world();
    expect(importanceMarks(markableCategories(db), [food.id], [food.id]).get(food.id)).toBe(3);
  });

  test("a child whose folder is not being asked about still answers for itself", () => {
    const db = fresh();
    const gone = createCategory(db, { name: "Retired folder", archived: 1 });
    const inside = createCategory(db, { name: "Inside it", parent_id: gone.id });
    // The folder is archived, so it is not in the markable set; the category is, having a mark of
    // its own is the only way it can be answered at all.
    const asked = markableCategories(db).concat(getRow(db, "categories", inside.id) as Category);
    const marks = importanceMarks(asked.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i), [inside.id], []);
    expect(marks.get(inside.id)).toBe(3);
  });
});

describe("writing it", () => {
  test("a mark that changes nothing writes nothing", () => {
    const db = fresh();
    const rent = createCategory(db, { name: "Rent", importance: 3 });
    const before = getRow(db, "categories", rent.id)!.updated_at;
    const marks = importanceMarks(markableCategories(db), [rent.id], []);
    expect(importanceAffected(db, marks)).toHaveLength(0);
    expect(applyImportance(db, marks)).toBe(0);
    // An untouched row must not get a fresh updated_at: that is what decides a merge (DATA.md rule 2).
    expect(getRow(db, "categories", rent.id)!.updated_at).toBe(before);
  });

  test("only the rows that change are written", () => {
    const db = fresh();
    const rent = createCategory(db, { name: "Rent", importance: 3 });
    const bars = createCategory(db, { name: "Bars" });
    const rentBefore = getRow(db, "categories", rent.id)!.updated_at;
    const marks = importanceMarks(markableCategories(db), [rent.id], [bars.id]);
    expect(applyImportance(db, marks)).toBe(1);
    expect(getRow(db, "categories", rent.id)!.updated_at).toBe(rentBefore);
    expect((getRow(db, "categories", bars.id) as Category).importance).toBe(1);
  });

  test("re-running the same marking is a no-op", () => {
    const db = fresh();
    const home = createCategory(db, { name: "Home" });
    createCategory(db, { name: "Rent", parent_id: home.id });
    const fun = createCategory(db, { name: "Fun" });
    const marks = importanceMarks(markableCategories(db), [home.id], [fun.id]);
    expect(applyImportance(db, marks)).toBeGreaterThan(0);
    expect(applyImportance(db, importanceMarks(markableCategories(db), [home.id], [fun.id]))).toBe(0);
  });

  test("the whole flow leaves nothing unmarked", () => {
    const db = fresh();
    const home = createCategory(db, { name: "Home" });
    createCategory(db, { name: "Rent", parent_id: home.id });
    createCategory(db, { name: "Power", parent_id: home.id });
    createCategory(db, { name: "Bars" });
    createCategory(db, { name: "Food" });
    expect(unmarkedCount(markableCategories(db))).toBe(4);
    applyImportance(db, importanceMarks(markableCategories(db), [home.id], []));
    expect(unmarkedCount(markableCategories(db))).toBe(0);
  });
});

describe("the column", () => {
  test("v16 adds it and everything starts unset", () => {
    const db = openBunDb(":memory:");
    migrate(db);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pragma_table_info('categories') WHERE name='importance'`)?.n).toBe(1);
    expect(MIGRATIONS.length).toBe(16);
    const rent = createCategory(db, { name: "Rent" });
    expect((getRow(db, "categories", rent.id) as Category).importance).toBe(0);
  });

  test("the mark travels in a backup", () => {
    const db = fresh();
    const subs = createCategory(db, { name: "Subscriptions", importance: 1 });
    createCategory(db, { name: "Netflix", parent_id: subs.id });
    // Without `importance` in TABLE_COLUMNS this passes locally and loses the answer on the other
    // phone, which is the whole reason the test is here.
    const file = JSON.parse(JSON.stringify(exportBackup(db, { compact: true })));
    expect(file.categories.find((c: { name: string }) => c.name === "Subscriptions").importance).toBe(1);
    const other = fresh();
    importBackup(other, file, { mode: "replace" });
    const there = (listRows(other, "categories", "deleted=0") as Category[]).find((c) => c.name === "Netflix")!;
    expect(categoryImportance(cats(other)).get(there.id)).toBe(1);
  });

  test("a row from an older phone arrives unset rather than breaking", () => {
    const db = openBunDb(":memory:");
    migrate(db);
    // No `importance` column in the INSERT: what an export written before v16 carries.
    db.run(`INSERT INTO categories (id, updated_at, deleted, name, parent_id, sort, kind) VALUES ('c1', 1, 0, 'Rent', NULL, 0, 'expense')`);
    expect((getRow(db, "categories", "c1") as Category).importance).toBe(0);
  });
});
