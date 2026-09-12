import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createCategory, listRows } from "../src/repo";
import { CATEGORY_PRESET, presetCounts, seedCategories } from "../src/presets";
import { ICON_PRESETS } from "../src/icons";

describe("category preset", () => {
  test("every icon is one the editor offers and every category has a description", () => {
    for (const f of CATEGORY_PRESET) {
      expect(ICON_PRESETS).toContain(f.icon);
      for (const c of f.categories) { expect(ICON_PRESETS).toContain(c.icon); expect(c.description.length).toBeGreaterThan(5); }
    }
  });
  test("seeding creates folders and categories once, reusing existing names", () => {
    const db = openBunDb(); migrate(db);
    createCategory(db, { name: "food", parent_id: null });
    const first = seedCategories(db);
    const { folders, categories } = presetCounts();
    expect(first.created).toBe(folders + categories - 1);
    expect(listRows(db, "categories", "deleted=0 AND parent_id IS NULL")).toHaveLength(folders);
    const groceries = listRows(db, "categories", "deleted=0 AND name='Groceries'")[0]!;
    expect(groceries.description).toContain("supermarket");
    expect(listRows(db, "categories", "deleted=0 AND id=?", [groceries.parent_id!])[0]!.name).toBe("food");
    expect(seedCategories(db).created).toBe(0);
    expect(listRows(db, "categories", "deleted=0 AND kind='income'").length).toBeGreaterThan(3);
  });
});
