import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate, MIGRATIONS } from "../src/schema";
import { createCategory, getRow, listRows } from "../src/repo";
import { CATEGORY_PRESET, categoryDescription, categoryMatchText, categoryName, presetCounts, presetDescription, presetKey, presetName, seedCategories } from "../src/presets";
import { exportBackup, importBackup } from "../src/backup";
import { ICON_PRESETS } from "../src/icons";
import { LANGUAGES } from "@kopiyka/i18n/generated";

describe("category preset", () => {
  test("every icon is one the editor offers, and every preset is named and described in every language", () => {
    for (const f of CATEGORY_PRESET) {
      expect(ICON_PRESETS).toContain(f.icon);
      for (const l of LANGUAGES) expect(presetName(f.key, l.code)).toBeTruthy();
      for (const c of f.categories) {
        expect(ICON_PRESETS).toContain(c.icon);
        for (const l of LANGUAGES) {
          expect(presetName(presetKey(f.key, c.key), l.code)).toBeTruthy();
          expect(presetDescription(presetKey(f.key, c.key), l.code)!.length).toBeGreaterThan(5);
        }
      }
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
    expect(groceries.preset).toBe("food.groceries");
    expect(groceries.description).toContain("supermarket");
    expect(listRows(db, "categories", "deleted=0 AND id=?", [groceries.parent_id!])[0]!.name).toBe("food");
    expect(seedCategories(db).created).toBe(0);
    // Seeding again in another language finds what is there by key, and adds nothing.
    expect(seedCategories(db, "uk").created).toBe(0);
    expect(listRows(db, "categories", "deleted=0 AND kind='income'").length).toBeGreaterThan(3);
  });

  test("seeded in Ukrainian, shown in either language", () => {
    const db = openBunDb(); migrate(db);
    seedCategories(db, "uk");
    const g = listRows(db, "categories", "deleted=0 AND preset='food.groceries'")[0]!;
    expect(g.name).toBe("Продукти");
    expect(categoryName(g, "uk")).toBe("Продукти");
    expect(categoryName(g, "en")).toBe("Groceries");
    expect(categoryDescription(g, "en")).toContain("supermarket");
  });
});

describe("a preset category is translated only while it keeps the preset's name", () => {
  const groceries = { name: "Groceries", preset: "food.groceries", description: presetDescription("food.groceries", "en") };

  test("unrenamed: follows the language, whatever language it was seeded in, case aside", () => {
    expect(categoryName(groceries, "uk")).toBe("Продукти");
    expect(categoryName({ ...groceries, name: "продукти " }, "en")).toBe("Groceries");
  });

  test("renamed, or made by the user: shown exactly as written", () => {
    expect(categoryName({ ...groceries, name: "Їжа вдома" }, "en")).toBe("Їжа вдома");
    expect(categoryName({ name: "Groceries", preset: null }, "uk")).toBe("Groceries");
    expect(categoryName({ name: "Groceries" }, "uk")).toBe("Groceries");
    expect(categoryName({ name: "Groceries", preset: "a.key.from.a.newer.build" }, "uk")).toBe("Groceries");
  });

  test("an untouched description matches every language's keywords; an edited one only its own", () => {
    const all = categoryMatchText(groceries)!;
    expect(all).toContain("supermarket");
    expect(all).toContain("Сільпо");
    expect(categoryMatchText({ ...groceries, description: "bread, milk" })).toBe("bread, milk");
    expect(categoryDescription({ ...groceries, description: "bread, milk" }, "uk")).toBe("bread, milk");
  });
});

describe("v18 backfill", () => {
  test("tags what an earlier build seeded in English, leaves renamed and user rows alone, and does not touch updated_at", () => {
    const db = openBunDb();
    // A database as 1.0.2 left it: migrated to v17, English preset rows, one renamed, one of the user's own.
    db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.transaction(() => { for (const stmt of MIGRATIONS.slice(0, 17).flat()) db.run(stmt); });
    db.run(`INSERT INTO meta(key, value) VALUES ('schema_version', '17')`);
    const add = (id: string, name: string, parent: string | null) =>
      db.run(`INSERT INTO categories (id, updated_at, deleted, name, parent_id) VALUES (?, 1000, 0, ?, ?)`, [id, name, parent]);
    add("f", "Food", null); add("g", "Groceries", "f"); add("r", "Eating out", "f");
    add("t", "Transport", null); add("x", "Groceries", "t");   // the right name in the wrong folder
    add("mine", "Climbing", null);
    migrate(db);
    const preset = (id: string) => getRow(db, "categories", id)!.preset ?? null;
    expect(preset("f")).toBe("food");
    expect(preset("g")).toBe("food.groceries");
    expect(preset("r")).toBeNull();
    expect(preset("t")).toBe("transport");
    expect(preset("x")).toBeNull();
    expect(preset("mine")).toBeNull();
    expect(getRow(db, "categories", "g")!.updated_at).toBe(1000);
  });
});

describe("the preset key travels", () => {
  test("in a backup, and a file from a build that never had it keeps what the phone knows", () => {
    const a = openBunDb(); migrate(a);
    seedCategories(a);
    const b = openBunDb(); migrate(b);
    importBackup(b, exportBackup(a));
    expect(listRows(b, "categories", "preset='food.groceries'")).toHaveLength(1);
    // An older build's newer copy of the row, without the column: the key stays.
    const row = listRows(b, "categories", "preset='food.groceries'")[0]!;
    const { preset: _drop, ...old } = row;
    importBackup(b, { ...exportBackup(b), categories: [{ ...old, color: "#000000", updated_at: row.updated_at + 1 }] });
    expect(getRow(b, "categories", row.id)!.preset).toBe("food.groceries");
    expect(getRow(b, "categories", row.id)!.color).toBe("#000000");
  });
});

describe("a backup from before v18 restored into a fresh database", () => {
  // The v18 migration tags what is already on the phone; a 1.0.2 backup restored afterwards writes
  // its categories with no `preset`, so the import runs the same backfill.
  for (const mode of ["merge", "replace"] as const) {
    test(`${mode}: its ready-made categories are tagged, its own are not, and updated_at is untouched`, () => {
      const a = openBunDb(); migrate(a);
      seedCategories(a);
      createCategory(a, { name: "Climbing", parent_id: null });
      const file = exportBackup(a);
      // As 1.0.2 wrote it: no `preset` column, no `schema`.
      file.categories = file.categories.map(({ preset: _p, ...c }) => c as typeof c & { preset?: string | null });
      delete file.schema;

      const b = openBunDb(); migrate(b);
      importBackup(b, file, { mode });
      const g = listRows(b, "categories", "deleted=0 AND name='Groceries'")[0]!;
      expect(g.preset).toBe("food.groceries");
      expect(listRows(b, "categories", "deleted=0 AND name='Food' AND parent_id IS NULL")[0]!.preset).toBe("food");
      expect(listRows(b, "categories", "deleted=0 AND name='Climbing'")[0]!.preset ?? null).toBeNull();
      expect(g.updated_at).toBe(file.categories.find((c) => c.id === g.id)!.updated_at);
    });
  }
});
