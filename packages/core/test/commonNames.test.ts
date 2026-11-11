import { describe, expect, test } from "bun:test";
import { nameLooksIn, suggestName, wantsTranslation } from "../src/commonNames";

describe("suggested names for categories of your own", () => {
  test("whole names, case and spacing aside", () => {
    expect(suggestName("Cats", "uk")).toBe("Коти");
    expect(suggestName("  car WASH ", "uk")).toBe("Мийка авто");
    expect(suggestName("Повернення", "en")).toBe("Refunds");
  });
  test("part by part, only when every part is known", () => {
    expect(suggestName("Car (General)", "uk")).toBe("Авто (загальне)");
    expect(suggestName("Travel/Leisure", "uk")).toBe("Подорожі/відпочинок");
    expect(suggestName("Rower (Bicycle)", "uk")).toBe("Велосипед");
    expect(suggestName("Ola Wishes", "uk")).toBeNull();
    expect(suggestName("Cats / Zorgs", "uk")).toBeNull();
  });
  test("only a name in another language than the app's wants one", () => {
    expect(nameLooksIn("Cats", "en")).toBe(true);
    expect(nameLooksIn("Cats", "uk")).toBe(false);
    expect(nameLooksIn("Коти", "uk")).toBe(true);
    expect(nameLooksIn("2024", "uk")).toBe(true);
    expect(wantsTranslation({ name: "Cats", preset: null }, "uk")).toBe(true);
    expect(wantsTranslation({ name: "Cats", preset: null }, "en")).toBe(false);
    // A ready-made category under its own name is translated already.
    expect(wantsTranslation({ name: "Groceries", preset: "food.groceries" }, "uk")).toBe(false);
  });
});
