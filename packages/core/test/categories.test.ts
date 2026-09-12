import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createCategory, folderIds, listRows } from "../src/repo";

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
