import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { budgetCategoryIds, convertCategoryToTag, convertTagToCategory, createAccount, createBudget, createCategory, createTag, createTransaction, folderIds, getRow, jsonIds, listRows } from "../src/repo";

describe("folders", () => {
  test("a top-level category with categories inside it is a folder", () => {
    const db = openBunDb(); migrate(db);
    const food = createCategory(db, { name: "Food" });
    const coffee = createCategory(db, { name: "Coffee", parent_id: food.id });
    const folders = folderIds(listRows(db, "categories", "deleted=0"));
    expect(folders.has(food.id)).toBe(true);
    expect(folders.has(coffee.id)).toBe(false);
  });
  test("a top-level category with nothing inside it stays pickable", () => {
    const db = openBunDb(); migrate(db);
    const rent = createCategory(db, { name: "Rent" });
    expect(folderIds(listRows(db, "categories", "deleted=0")).has(rent.id)).toBe(false);
  });
  test("only live children make a folder", () => {
    const db = openBunDb(); migrate(db);
    const food = createCategory(db, { name: "Food" });
    createCategory(db, { name: "Coffee", parent_id: food.id });
    // The picker asks with the deleted rows already filtered out, which is what makes emptying a
    // folder hand its name back to the list instead of leaving an unpickable row behind.
    expect(folderIds(listRows(db, "categories", "deleted=0 AND name!='Coffee'")).has(food.id)).toBe(false);
  });
});

describe("turning a category into a tag", () => {
  function world() {
    const db = openBunDb();
    migrate(db);
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const food = createCategory(db, { name: "Food" });
    const lidl = createCategory(db, { name: "Lidl", parent_id: food.id });
    return { db, acc, food, lidl };
  }

  test("transactions keep their history: same rows, new tag, filed under the folder", () => {
    const { db, acc, food, lidl } = world();
    const t = createTransaction(db, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, category_id: lidl.id });
    const tag = convertCategoryToTag(db, lidl.id, { moveTo: food.id });
    const after = getRow(db, "transactions", t.id)!;
    expect(after.id).toBe(t.id);              // the row is the same row (rule 1)
    expect(after.category_id).toBe(food.id);
    expect(jsonIds(after.tag_ids)).toEqual([tag.id]);
    expect(getRow(db, "categories", lidl.id)!.deleted).toBe(1);
    // Food had one category in it and now has none, so it is an ordinary, pickable category (rule 5).
    expect(folderIds(listRows(db, "categories", "deleted=0")).has(food.id)).toBe(false);
  });

  test("with nowhere to move them, the transactions simply lose the category", () => {
    const { db, acc, lidl } = world();
    const t = createTransaction(db, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, category_id: lidl.id });
    convertCategoryToTag(db, lidl.id, { moveTo: null });
    expect(getRow(db, "transactions", t.id)!.category_id).toBeNull();
  });

  test("a folder refuses, so its categories are never orphaned", () => {
    const { db, food, lidl } = world();
    expect(() => convertCategoryToTag(db, food.id, { moveTo: null })).toThrow();
    expect(getRow(db, "categories", lidl.id)!.deleted).toBe(0);
  });

  test("a budget scoped to it alone becomes a budget on the tag, not on everything", () => {
    const { db, lidl } = world();
    const b = createBudget(db, { category_ids: JSON.stringify([lidl.id]), currency: "PLN", amount_minor: 30000, starts: "2026-09-01" });
    const tag = convertCategoryToTag(db, lidl.id, { moveTo: null });
    const after = getRow(db, "budgets", b.id)!;
    expect(budgetCategoryIds(after)).toEqual([]);
    expect(after.tag_id).toBe(tag.id);        // still about this spending, said the other way
  });

  test("a budget over several categories just loses this one", () => {
    const { db, food, lidl } = world();
    const b = createBudget(db, { category_ids: JSON.stringify([lidl.id, food.id]), currency: "PLN", amount_minor: 30000, starts: "2026-09-01" });
    convertCategoryToTag(db, lidl.id, { moveTo: food.id });
    const after = getRow(db, "budgets", b.id)!;
    expect(budgetCategoryIds(after)).toEqual([food.id]);
    expect(after.category_id).toBe(food.id);  // kept in step with the set (rule 5)
    expect(after.tag_id).toBeNull();
  });

  test("a tag offered only for it follows the transactions to their new home", () => {
    const { db, food, lidl } = world();
    const narrow = createTag(db, { name: "offers", category_ids: JSON.stringify([lidl.id]) });
    convertCategoryToTag(db, lidl.id, { moveTo: food.id });
    expect(jsonIds(getRow(db, "tags", narrow.id)!.category_ids)).toEqual([food.id]);
  });

  test("the round trip keeps the name and the transactions", () => {
    const { db, acc, food, lidl } = world();
    const t = createTransaction(db, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, category_id: lidl.id });
    const tag = convertCategoryToTag(db, lidl.id, { moveTo: food.id });
    const back = convertTagToCategory(db, tag.id, { parent_id: food.id });
    expect(back.name).toBe("Lidl");
    const after = getRow(db, "transactions", t.id)!;
    expect(after.id).toBe(t.id);
    expect(after.category_id).toBe(back.id);
    expect(jsonIds(after.tag_ids)).toEqual([]);
  });
});
